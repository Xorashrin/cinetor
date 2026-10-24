// SPDX-License-Identifier: GPL-3.0-or-later
package com.cinetor.engines.nuvio

import com.cinetor.engines.*
import com.dokar.quickjs.QuickJs
import com.dokar.quickjs.binding.function
import java.nio.ByteBuffer
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Locale
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Minimal JCA host for the reviewed Nuvio CryptoJS/WebCrypto compatibility layer. */
internal object CryptoBridge {
    private fun arg(args: Array<Any?>, index: Int) = args.getOrNull(index)?.toString() ?: ""
    private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it.toInt() and 255) }
    private fun bytes(raw: String): ByteArray {
        requireEngine(raw.length <= Limits.BODY * 2 && raw.length % 2 == 0 && raw.all { it in "0123456789abcdefABCDEF" },
            "LIMIT", "Invalid or oversized binary crypto input")
        return ByteArray(raw.length / 2) { raw.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    }
    private fun digestName(raw: String): String = when (raw.uppercase(Locale.US).replace("-", "")) {
        "MD5" -> "MD5"
        "SHA1" -> "SHA-1"
        "SHA256" -> "SHA-256"
        "SHA384" -> "SHA-384"
        "SHA512" -> "SHA-512"
        else -> throw EngineFailure("UNSUPPORTED_CRYPTO", "Unsupported digest algorithm")
    }
    private fun hmac(name: String, key: ByteArray, value: ByteArray): ByteArray {
        val algorithm = "Hmac" + digestName(name).replace("-", "")
        val mac = Mac.getInstance(algorithm)
        // An empty HMAC key is equivalent to a zero-filled block. JCA rejects an empty SecretKeySpec.
        mac.init(SecretKeySpec(if (key.isEmpty()) byteArrayOf(0) else key, algorithm))
        return mac.doFinal(value)
    }
    private fun aes(encrypt: Boolean, mode: String, key: ByteArray, iv: ByteArray, input: ByteArray): ByteArray {
        requireEngine(key.size in setOf(16, 24, 32), "MALFORMED", "AES key must be 128, 192, or 256 bits")
        val transformation = when (mode) {
            "AES-CBC" -> "AES/CBC/PKCS5Padding"
            "AES-CBC-NoPadding" -> "AES/CBC/NoPadding"
            "AES-ECB" -> "AES/ECB/PKCS5Padding"
            "AES-ECB-NoPadding" -> "AES/ECB/NoPadding"
            "AES-GCM" -> "AES/GCM/NoPadding"
            else -> throw EngineFailure("UNSUPPORTED_CRYPTO", "Unsupported AES mode")
        }
        val cipher = Cipher.getInstance(transformation)
        val keySpec = SecretKeySpec(key, "AES")
        val op = if (encrypt) Cipher.ENCRYPT_MODE else Cipher.DECRYPT_MODE
        when {
            mode.startsWith("AES-CBC") -> { requireEngine(iv.size == 16, "MALFORMED", "AES-CBC requires a 16-byte IV"); cipher.init(op, keySpec, IvParameterSpec(iv)) }
            mode == "AES-GCM" -> { requireEngine(iv.size == 12, "UNSUPPORTED_CRYPTO", "This AES-GCM profile requires a 12-byte IV"); cipher.init(op, keySpec, GCMParameterSpec(128, iv)) }
            else -> cipher.init(op, keySpec)
        }
        return cipher.doFinal(input)
    }

    fun register(runtime: QuickJs, checkActive: () -> Unit, guard: ((() -> Any?) -> Any?)) {
        fun bind(name: String, block: (Array<Any?>) -> Any?) { runtime.function(name) { args -> guard { checkActive(); block(args) } } }
        bind("__crypto_digest_hex_raw") { a -> hex(MessageDigest.getInstance(digestName(arg(a, 0))).digest(bytes(arg(a, 1)))) }
        bind("__crypto_hmac_hex_raw") { a -> hex(hmac(arg(a, 0), bytes(arg(a, 1)), bytes(arg(a, 2)))) }
        bind("__crypto_aes_encrypt_hex") { a -> hex(aes(true, arg(a, 0), bytes(arg(a, 1)), bytes(arg(a, 2)), bytes(arg(a, 3)))) }
        bind("__crypto_aes_decrypt_hex") { a -> hex(aes(false, arg(a, 0), bytes(arg(a, 1)), bytes(arg(a, 2)), bytes(arg(a, 3)))) }
        bind("__crypto_pbkdf2_hex") { a ->
            val password = bytes(arg(a, 0)); val salt = bytes(arg(a, 1))
            val iterations = (a.getOrNull(2) as? Number)?.toInt() ?: 0
            val bits = (a.getOrNull(3) as? Number)?.toInt() ?: 0
            requireEngine(iterations in 1..100000 && bits in 8..4096 && bits % 8 == 0,
                "LIMIT", "PBKDF2 work budget exceeded")
            val algorithm = arg(a, 4)
            val output = ByteArray(bits / 8)
            var offset = 0
            var block = 1
            while (offset < output.size) {
                val blockNumber = ByteBuffer.allocate(4).putInt(block++).array()
                var u = hmac(algorithm, password, salt + blockNumber)
                val t = u.copyOf()
                for (round in 1 until iterations) {
                    if (round % 128 == 0) checkActive()
                    u = hmac(algorithm, password, u)
                    for (i in t.indices) t[i] = (t[i].toInt() xor u[i].toInt()).toByte()
                }
                val count = minOf(t.size, output.size - offset)
                t.copyInto(output, offset, 0, count)
                offset += count
            }
            hex(output)
        }
        bind("__crypto_get_random_values_hex") { a ->
            val count = (a.firstOrNull() as? Number)?.toInt() ?: 0
            requireEngine(count in 0..65536, "LIMIT", "Random byte budget exceeded")
            hex(ByteArray(count).apply { SecureRandom().nextBytes(this) })
        }
        bind("__crypto_utf8_to_hex") { a -> val value = arg(a, 0).toByteArray(Charsets.UTF_8)
            requireEngine(value.size <= Limits.BODY, "LIMIT", "Encoded text exceeds the budget"); hex(value) }
        bind("__crypto_hex_to_utf8") { a -> bytes(arg(a, 0)).toString(Charsets.UTF_8) }
        bind("__decode_text") { a ->
            val label = arg(a, 1).lowercase(Locale.US)
            requireEngine(label in setOf("utf-8", "utf8", "utf-16le", "utf-16be", "iso-8859-1", "windows-1252", "ascii"),
                "UNSUPPORTED_ENCODING", "Unsupported text encoding")
            val charset = Charset.forName(if (label in setOf("iso-8859-1", "ascii")) "windows-1252" else label)
            val action = if (a.getOrNull(2) == true) CodingErrorAction.REPORT else CodingErrorAction.REPLACE
            charset.newDecoder().onMalformedInput(action).onUnmappableCharacter(action).decode(ByteBuffer.wrap(bytes(arg(a, 0)))).toString()
        }
        for (name in listOf("__crypto_sign_hex", "__crypto_verify_hex")) bind(name) {
            throw EngineFailure("UNSUPPORTED_CRYPTO", "Asymmetric signing is not in this host profile")
        }
    }
}
