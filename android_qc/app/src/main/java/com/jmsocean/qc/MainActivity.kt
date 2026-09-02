package com.jmsocean.qc

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.jmsocean.qc.ui.fpa.FpaScreen
import com.jmsocean.qc.ui.login.LoginScreen
import com.jmsocean.qc.ui.queue.QueueScreen
import com.jmsocean.qc.ui.theme.QcTheme
import com.jmsocean.qc.ui.verify.VerifyScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            QcTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    QcNavHost()
                }
            }
        }
    }
}

private object Routes {
    const val LOGIN = "login"
    const val QUEUE = "queue"
    const val FPA = "fpa"
    const val VERIFY = "verify"
}

@Composable
fun QcNavHost() {
    val nav = rememberNavController()
    val app = QcApp.instance
    val start = if (app.session.isLoggedIn) Routes.QUEUE else Routes.LOGIN

    NavHost(navController = nav, startDestination = start) {
        composable(Routes.LOGIN) {
            LoginScreen(
                onLoggedIn = {
                    nav.navigate(Routes.QUEUE) {
                        popUpTo(Routes.LOGIN) { inclusive = true }
                    }
                }
            )
        }
        composable(Routes.QUEUE) {
            QueueScreen(
                onLogout = {
                    nav.navigate(Routes.LOGIN) {
                        popUpTo(Routes.QUEUE) { inclusive = true }
                    }
                },
                onOpenFpa = { nav.navigate(Routes.FPA) },
                onOpenVerify = { nav.navigate(Routes.VERIFY) }
            )
        }
        composable(Routes.FPA) {
            FpaScreen(onBack = { nav.popBackStack() })
        }
        composable(Routes.VERIFY) {
            VerifyScreen(onBack = { nav.popBackStack() })
        }
    }
}
