// SPDX-License-Identifier: GPL-3.0-or-later
package com.cinetor.engines

import android.os.SystemClock
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

internal class RequestControl(val requestId: String, private val job: Job, val budgetMs: Long) {
    private val started = SystemClock.elapsedRealtime()
    private val hooks = CopyOnWriteArrayList<() -> Unit>()
    @Volatile var reason: String? = null
        private set
    fun remaining(): Long = (budgetMs - (SystemClock.elapsedRealtime() - started)).coerceAtLeast(1)
    fun check() {
        if (reason == null && SystemClock.elapsedRealtime() - started >= budgetMs) cancel("TIMEOUT")
        reason?.let { throw EngineFailure(it, if (it == "TIMEOUT") "Engine deadline exceeded" else "Request cancelled") }
        job.ensureActive()
    }
    fun onCancel(hook: () -> Unit): AutoCloseable {
        hooks.add(hook)
        if (reason != null) hook()
        return AutoCloseable { hooks.remove(hook) }
    }
    @Synchronized fun cancel(code: String = "CANCELLED") {
        if (reason != null) return
        reason = code
        hooks.forEach { runCatching { it() } }
        job.cancel(CancellationException(code))
    }
}

internal class Requests : AutoCloseable {
    private val active = ConcurrentHashMap<String, RequestControl>()
    private val cancelled = ConcurrentHashMap<String, Long>()
    private val slots = Semaphore(2)
    private val clock = java.util.concurrent.ScheduledThreadPoolExecutor(1) { runnable ->
        Thread(runnable, "CinetorEngineDeadline").apply { isDaemon = true }
    }.apply { removeOnCancelPolicy = true }
    @Volatile private var closed = false

    suspend fun run(input: Map<String, Any?>, block: suspend (RequestControl) -> Map<String, Any?>): Map<String, Any?> {
        var control: RequestControl? = null
        var requestJob: CompletableJob? = null
        var timer: java.util.concurrent.ScheduledFuture<*>? = null
        try {
            requireEngine(!closed, "CANCELLED", "Engine module is closed")
            val id = input.text("requestId", 128)
            requireEngine(active.size < 16, "LIMIT", "Native request queue is full")
            val budget = (input["deadlineMs"] as? Number)?.toLong()?.coerceIn(1, Limits.TIMEOUT) ?: Limits.TIMEOUT
            val parent = currentCoroutineContext()[Job]
            val job = Job(parent)
            requestJob = job
            val token = RequestControl(id, job, budget)
            control = token
            val existing = synchronized(active) {
                requireEngine(active.size < 16, "LIMIT", "Native request queue is full")
                active.putIfAbsent(id, token)
            }
            if (existing != null) {
                job.complete()
                control = null
                throw EngineFailure("INVALID_REQUEST", "Request identifiers must be unique")
            }
            cancelled.remove(id)?.let { token.cancel() }
            if (closed) token.cancel()
            timer = clock.schedule({ token.cancel("TIMEOUT") }, budget, TimeUnit.MILLISECONDS)
            return try {
                withContext(job + Dispatchers.IO) {
                    slots.withPermit { token.check(); block(token).also { token.check() } }
                }
            } finally { job.complete() }
        } catch (error: Throwable) {
            if (error is VirtualMachineError || error is ThreadDeath) throw error
            val failure = control?.reason?.let { EngineFailure(it, if (it == "TIMEOUT") "Engine deadline exceeded" else "Request cancelled") } ?: error
            return errorResult(failure, input)
        } finally {
            timer?.cancel(false)
            requestJob?.complete()
            control?.let { active.remove(it.requestId, it) }
        }
    }

    fun cancel(id: String): Boolean {
        active[id]?.let { it.cancel(); return true }
        val now = SystemClock.elapsedRealtime()
        cancelled.entries.removeIf { now - it.value > Limits.TIMEOUT }
        if (cancelled.size < 128) cancelled[id] = now
        return false
    }

    override fun close() { closed = true; active.values.forEach { it.cancel() }; clock.shutdownNow() }
}
