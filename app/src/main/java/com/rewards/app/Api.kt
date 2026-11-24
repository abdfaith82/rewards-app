package com.rewards.app

import android.content.Context
import com.rewards.app.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale

class ApiException(message: String) : Exception(message)

class Session(ctx: Context) {
    private val sp = ctx.getSharedPreferences("session", Context.MODE_PRIVATE)
    var token: String?
        get() = sp.getString("token", null)
        set(value) {
            sp.edit().putString("token", value).apply()
        }
}

object Api {
    suspend fun call(
        method: String,
        path: String,
        token: String?,
        body: JSONObject? = null,
    ): JSONObject = withContext(Dispatchers.IO) {
        val conn = URL(BuildConfig.API_BASE_URL.trimEnd('/') + path)
            .openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = 15000
            conn.readTimeout = 20000
            conn.setRequestProperty("Accept", "application/json")
            if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            val json = try {
                JSONObject(text)
            } catch (e: Exception) {
                JSONObject()
            }
            if (code !in 200..299) {
                throw ApiException(json.optString("error", "خطأ ($code)"))
            }
            json
        } catch (e: ApiException) {
            throw e
        } catch (e: Exception) {
            throw ApiException("تعذر الاتصال بالخادم")
        } finally {
            conn.disconnect()
        }
    }
}

fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }

fun money(cents: Long): String = String.format(Locale.US, "$%.2f", cents / 100.0)
