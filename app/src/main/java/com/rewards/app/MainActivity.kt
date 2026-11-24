package com.rewards.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

enum class Screen { HOME, OFFERWALL, WITHDRAW, HISTORY }

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CrashLogger.install(this)
        val session = Session(applicationContext)
        val crash = CrashLogger.consume(applicationContext)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    App(session, crash)
                }
            }
        }
    }
}

@Composable
fun App(session: Session, crashText: String?) {
    var crash by remember { mutableStateOf(crashText) }
    var token by remember { mutableStateOf(session.token) }
    var screen by remember { mutableStateOf(Screen.HOME) }

    if (crash != null) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("انهار التطبيق في المرة السابقة", style = MaterialTheme.typography.titleMedium)
            SelectionContainer { Text(crash ?: "") }
            Button(onClick = { crash = null }) { Text("متابعة") }
        }
        return
    }

    val t = token
    if (t == null) {
        AuthScreen(onDone = { newToken ->
            session.token = newToken
            token = newToken
            screen = Screen.HOME
        })
        return
    }

    val logout = {
        session.token = null
        token = null
    }
    when (screen) {
        Screen.HOME -> HomeScreen(t, onNav = { screen = it }, onLogout = logout)
        Screen.OFFERWALL -> OfferwallScreen(t, onBack = { screen = Screen.HOME })
        Screen.WITHDRAW -> WithdrawScreen(t, onBack = { screen = Screen.HOME })
        Screen.HISTORY -> HistoryScreen(t, onBack = { screen = Screen.HOME })
    }
}
