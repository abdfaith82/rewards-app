package com.rewards.app

import android.content.Context
import java.io.File

object CrashLogger {
    private const val FILE = "last_crash.txt"

    fun install(ctx: Context) {
        val app = ctx.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            try {
                File(app.filesDir, FILE).writeText(error.stackTraceToString())
            } catch (_: Exception) {
            }
            previous?.uncaughtException(thread, error)
        }
    }

    /** يقرأ نص الانهيار الأخير (إن وُجد) ثم يحذفه. */
    fun consume(ctx: Context): String? {
        val f = File(ctx.filesDir, FILE)
        if (!f.exists()) return null
        val text = runCatching { f.readText() }.getOrNull()
        f.delete()
        return text
    }
}
