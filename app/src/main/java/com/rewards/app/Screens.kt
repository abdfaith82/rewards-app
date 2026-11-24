package com.rewards.app

import android.annotation.SuppressLint
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.Locale

// ---------- الدخول / التسجيل ----------
@Composable
fun AuthScreen(onDone: (String) -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var register by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            if (register) "إنشاء حساب" else "تسجيل الدخول",
            style = MaterialTheme.typography.headlineMedium,
        )
        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            label = { Text("البريد الإلكتروني") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 16.dp),
        )
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("كلمة المرور (8 أحرف على الأقل)") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 8.dp),
        )
        error?.let {
            Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
        }
        Button(
            enabled = !loading && email.isNotBlank() && password.isNotBlank(),
            onClick = {
                loading = true
                error = null
                scope.launch {
                    try {
                        val res = Api.call(
                            "POST",
                            if (register) "/auth/register" else "/auth/login",
                            null,
                            JSONObject().put("email", email.trim()).put("password", password),
                        )
                        onDone(res.getString("token"))
                    } catch (e: ApiException) {
                        error = e.message
                    } catch (e: Exception) {
                        error = "حدث خطأ غير متوقع"
                    }
                    loading = false
                }
            },
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 16.dp),
        ) {
            Text(if (loading) "..." else if (register) "إنشاء الحساب" else "دخول")
        }
        TextButton(onClick = { register = !register; error = null }) {
            Text(if (register) "لدي حساب، تسجيل الدخول" else "ليس لدي حساب، إنشاء حساب")
        }
    }
}

// ---------- مساعد تحميل /me ----------
@Composable
private fun rememberMe(token: String, reload: Int = 0): Triple<JSONObject?, String?, Boolean> {
    var me by remember { mutableStateOf<JSONObject?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    LaunchedEffect(token, reload) {
        loading = true
        error = null
        try {
            me = Api.call("GET", "/me", token)
        } catch (e: ApiException) {
            error = e.message
        }
        loading = false
    }
    return Triple(me, error, loading)
}

// ---------- الرئيسية ----------
@Composable
fun HomeScreen(token: String, onNav: (Screen) -> Unit, onLogout: () -> Unit) {
    val (me, error, loading) = rememberMe(token)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("رصيدك", style = MaterialTheme.typography.titleMedium)
        when {
            loading -> CircularProgressIndicator()
            me != null -> Text(
                money(me.optLong("balanceCents")),
                style = MaterialTheme.typography.displayMedium,
            )
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        me?.let { Text(it.optString("email")) }

        Button(onClick = { onNav(Screen.OFFERWALL) }, modifier = Modifier.fillMaxWidth()) {
            Text("ابدأ المهام والاستبيانات")
        }
        OutlinedButton(onClick = { onNav(Screen.WITHDRAW) }, modifier = Modifier.fillMaxWidth()) {
            Text("سحب الأرباح إلى PayPal")
        }
        OutlinedButton(onClick = { onNav(Screen.HISTORY) }, modifier = Modifier.fillMaxWidth()) {
            Text("السجل")
        }
        TextButton(onClick = onLogout) { Text("تسجيل الخروج") }
    }
}

// ---------- جدار العروض ----------
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun OfferwallScreen(token: String, onBack: () -> Unit) {
    var url by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    BackHandler { onBack() }

    LaunchedEffect(token) {
        try {
            url = Api.call("GET", "/offerwall-url", token).getString("url")
        } catch (e: ApiException) {
            error = e.message
        } catch (e: Exception) {
            error = "تعذر تحميل المهام"
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        TextButton(onClick = onBack) { Text("رجوع") }
        val u = url
        when {
            error != null -> Text(
                error ?: "",
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(16.dp),
            )
            u == null -> CircularProgressIndicator(modifier = Modifier.padding(16.dp))
            else -> AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                    WebView(ctx).apply {
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        webViewClient = WebViewClient()
                        loadUrl(u)
                    }
                },
            )
        }
    }
}

// ---------- السحب ----------
@Composable
fun WithdrawScreen(token: String, onBack: () -> Unit) {
    var reload by remember { mutableStateOf(0) }
    val (me, loadError, loading) = rememberMe(token, reload)
    var paypal by remember { mutableStateOf("") }
    var amount by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var failed by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    BackHandler { onBack() }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        TextButton(onClick = onBack) { Text("رجوع") }
        Text("سحب إلى PayPal", style = MaterialTheme.typography.headlineSmall)
        if (loading) CircularProgressIndicator()
        loadError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        me?.let {
            Text("الرصيد: " + money(it.optLong("balanceCents")))
            Text("أقل مبلغ للسحب: " + money(it.optLong("minWithdrawCents")))
        }
        OutlinedTextField(
            value = paypal,
            onValueChange = { paypal = it },
            label = { Text("بريد حساب PayPal") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = amount,
            onValueChange = { amount = it },
            label = { Text("المبلغ بالدولار") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.fillMaxWidth(),
        )
        message?.let {
            Text(it, color = if (failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
        }
        Button(
            enabled = !busy && paypal.isNotBlank() && amount.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                val dollars = amount.trim().replace(',', '.').toDoubleOrNull()
                if (dollars == null || dollars <= 0) {
                    failed = true
                    message = "أدخل مبلغاً صحيحاً"
                } else {
                    busy = true
                    message = null
                    scope.launch {
                        try {
                            Api.call(
                                "POST", "/withdraw", token,
                                JSONObject()
                                    .put("paypalEmail", paypal.trim())
                                    .put("cents", Math.round(dollars * 100)),
                            )
                            failed = false
                            message = "تم إرسال الطلب، سيُراجع ويُحوَّل إلى PayPal"
                            amount = ""
                            reload += 1
                        } catch (e: ApiException) {
                            failed = true
                            message = e.message
                        }
                        busy = false
                    }
                }
            },
        ) { Text(if (busy) "..." else "اطلب السحب") }
    }
}

// ---------- السجل ----------
@Composable
fun HistoryScreen(token: String, onBack: () -> Unit) {
    val (me, error, loading) = rememberMe(token)
    BackHandler { onBack() }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        TextButton(onClick = onBack) { Text("رجوع") }
        if (loading) CircularProgressIndicator()
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        me?.let { data ->
            val withdrawals = data.optJSONArray("withdrawals")?.objects() ?: emptyList()
            val history = data.optJSONArray("history")?.objects() ?: emptyList()
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (withdrawals.isNotEmpty()) {
                    item { Text("طلبات السحب", style = MaterialTheme.typography.titleMedium) }
                    items(withdrawals) { w ->
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(statusLabel(w.optString("status")))
                            Text(money(w.optLong("cents")))
                        }
                    }
                }
                item { Text("الحركات", style = MaterialTheme.typography.titleMedium) }
                items(history) { h ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Column {
                            Text(h.optString("note", ""))
                            Text(h.optString("created_at"), style = MaterialTheme.typography.bodySmall)
                        }
                        val c = h.optLong("cents")
                        Text((if (c > 0) "+" else "-") + money(Math.abs(c)))
                    }
                }
            }
        }
    }
}

private fun statusLabel(s: String): String = when (s.lowercase(Locale.US)) {
    "pending" -> "قيد المراجعة"
    "processing" -> "قيد التحويل"
    "paid" -> "تم الدفع"
    "rejected" -> "مرفوض"
    "failed" -> "فشل (أُعيد المبلغ)"
    else -> s
}
