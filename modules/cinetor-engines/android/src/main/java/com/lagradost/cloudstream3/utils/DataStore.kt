// SPDX-License-Identifier: GPL-3.0-only
// Adapted October 24, 2026 from Cloudstream 4.8 DataStore.kt; persistent APIs, not silent no-ops.
package com.lagradost.cloudstream3.utils

import android.content.Context
import android.content.SharedPreferences
import com.lagradost.cloudstream3.utils.AppUtils.parseJson
import com.lagradost.cloudstream3.utils.AppUtils.toJsonLiteral

const val PREFERENCES_NAME = "cinetor_cloudstream_plugin_preferences"

data class Editor(val editor: SharedPreferences.Editor) {
    fun <T> setKeyRaw(path: String, value: T) {
        require(path.length <= 256)
        when (value) {
            is Boolean -> editor.putBoolean(path, value)
            is Int -> editor.putInt(path, value)
            is String -> { require(value.length <= 32768); editor.putString(path, value) }
            is Float -> editor.putFloat(path, value)
            is Long -> editor.putLong(path, value)
            is Set<*> -> {
                require(value.size <= 64 && value.all { it is String && it.length <= 4096 })
                @Suppress("UNCHECKED_CAST") editor.putStringSet(path, value as Set<String>)
            }
            else -> throw IllegalArgumentException("Unsupported preference type")
        }
    }
    fun apply() { editor.apply() }
}

object DataStore {
    val mapper = com.lagradost.cloudstream3.mapper
    fun Context.getSharedPrefs(): SharedPreferences = getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    fun Context.getDefaultSharedPrefs(): SharedPreferences = getSharedPreferences("${packageName}_preferences", Context.MODE_PRIVATE)
    fun getFolderName(folder: String, path: String): String = "$folder/$path"
    fun editor(context: Context, isEditingAppSettings: Boolean = false): Editor =
        Editor((if (isEditingAppSettings) context.getDefaultSharedPrefs() else context.getSharedPrefs()).edit())
    fun Context.getKeys(folder: String): List<String> = getSharedPrefs().all.keys.filter { it.startsWith(folder.trimEnd('/') + "/") }
    fun Context.containsKey(path: String): Boolean = getSharedPrefs().contains(path)
    fun Context.containsKey(folder: String, path: String): Boolean = containsKey(getFolderName(folder, path))
    fun Context.removeKey(path: String) { check(getSharedPrefs().edit().remove(path).commit()) }
    fun Context.removeKey(folder: String, path: String) = removeKey(getFolderName(folder, path))
    fun Context.removeKeys(folder: String): Int {
        val keys = getKeys(folder)
        val edit = getSharedPrefs().edit()
        keys.forEach { edit.remove(it) }
        check(edit.commit())
        return keys.size
    }
    fun <T> Context.setKey(path: String, value: T) {
        val json = value?.toJsonLiteral()
        require(path.length <= 256 && (json == null || json.length <= 32768))
        require(getSharedPrefs().all.size < 512 || containsKey(path))
        check(getSharedPrefs().edit().putString(path, json).commit())
    }
    fun <T> Context.setKey(folder: String, path: String, value: T) = setKey(getFolderName(folder, path), value)
    fun <T : Any> Context.getKey(path: String, valueType: Class<T>): T? =
        getSharedPrefs().getString(path, null)?.let { parseJson(it, valueType.kotlin) }
    inline fun <reified T : Any> String.toKotlinObject(): T = parseJson(this)
    fun <T : Any> String.toKotlinObject(valueType: Class<T>): T = parseJson(this, valueType.kotlin)
    inline fun <reified T : Any> Context.getKey(path: String, defVal: T?): T? = getKey(path, T::class.java) ?: defVal
    inline fun <reified T : Any> Context.getKey(path: String): T? = getKey(path, null as T?)
    inline fun <reified T : Any> Context.getKey(folder: String, path: String): T? = getKey(getFolderName(folder, path), null as T?)
    inline fun <reified T : Any> Context.getKey(folder: String, path: String, defVal: T?): T? = getKey(getFolderName(folder, path), defVal)
}
