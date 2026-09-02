package com.jmsocean.qc

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ExitToApp
import androidx.compose.material.icons.filled.GridOn
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.jmsocean.qc.ui.compliance.ComplianceScreen
import com.jmsocean.qc.ui.dashboard.DashboardScreen
import com.jmsocean.qc.ui.fpa.FpaScreen
import com.jmsocean.qc.ui.issues.IssuesScreen
import com.jmsocean.qc.ui.login.LoginScreen
import com.jmsocean.qc.ui.qcentry.QcEntryScreen
import com.jmsocean.qc.ui.queue.QueueScreen
import com.jmsocean.qc.ui.theme.QcTheme
import com.jmsocean.qc.ui.verify.VerifyScreen
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            QcTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    QcApp_Root()
                }
            }
        }
    }
}

private object Routes {
    const val LOGIN = "login"
    const val QUEUE = "queue"
    const val FPA = "fpa"
    const val QC = "qc"
    const val VERIFY = "verify"
    const val ISSUES = "issues"
    const val DASHBOARD = "dashboard"
    const val COMPLIANCE = "compliance"
}

@Composable
fun QcApp_Root() {
    val nav = rememberNavController()
    val app = QcApp.instance
    val scope = rememberCoroutineScope()
    val drawerState = androidx.compose.material3.rememberDrawerState(DrawerValue.Closed)

    val backStack by nav.currentBackStackEntryAsState()
    val current = backStack?.destination?.route
    val topLevel = setOf(Routes.QUEUE, Routes.VERIFY, Routes.ISSUES, Routes.DASHBOARD, Routes.COMPLIANCE)

    val start = if (app.session.isLoggedIn) Routes.QUEUE else Routes.LOGIN
    val openDrawer: () -> Unit = { scope.launch { drawerState.open() } }

    fun go(route: String) {
        scope.launch { drawerState.close() }
        if (route != current) {
            nav.navigate(route) {
                popUpTo(Routes.QUEUE) { inclusive = false }
                launchSingleTop = true
            }
        }
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        gesturesEnabled = current in topLevel,
        drawerContent = {
            ModalDrawerSheet {
                DrawerHeader(app.session.username, app.session.line)
                HorizontalDivider()
                Spacer(Modifier.height(8.dp))
                NavigationDrawerItem(
                    label = { Text("Job Queue") },
                    icon = { Icon(Icons.Default.List, null) },
                    selected = current == Routes.QUEUE,
                    onClick = { go(Routes.QUEUE) },
                    modifier = Modifier.padding(horizontal = 12.dp)
                )
                NavigationDrawerItem(
                    label = { Text("Verify Entries") },
                    icon = { Icon(Icons.Default.CheckCircle, null) },
                    selected = current == Routes.VERIFY,
                    onClick = { go(Routes.VERIFY) },
                    modifier = Modifier.padding(horizontal = 12.dp)
                )
                NavigationDrawerItem(
                    label = { Text("Material Issues") },
                    icon = { Icon(Icons.Default.Warning, null) },
                    selected = current == Routes.ISSUES,
                    onClick = { go(Routes.ISSUES) },
                    modifier = Modifier.padding(horizontal = 12.dp)
                )
                NavigationDrawerItem(
                    label = { Text("Quality Dashboard") },
                    icon = { Icon(Icons.Default.BarChart, null) },
                    selected = current == Routes.DASHBOARD,
                    onClick = { go(Routes.DASHBOARD) },
                    modifier = Modifier.padding(horizontal = 12.dp)
                )
                NavigationDrawerItem(
                    label = { Text("Compliance") },
                    icon = { Icon(Icons.Default.GridOn, null) },
                    selected = current == Routes.COMPLIANCE,
                    onClick = { go(Routes.COMPLIANCE) },
                    modifier = Modifier.padding(horizontal = 12.dp)
                )
                Spacer(Modifier.height(8.dp))
                HorizontalDivider()
                NavigationDrawerItem(
                    label = { Text("Log out") },
                    icon = { Icon(Icons.Default.ExitToApp, null) },
                    selected = false,
                    onClick = {
                        app.repository.logout()
                        scope.launch { drawerState.close() }
                        nav.navigate(Routes.LOGIN) { popUpTo(0) { inclusive = true } }
                    },
                    modifier = Modifier.padding(horizontal = 12.dp)
                )
            }
        }
    ) {
        NavHost(navController = nav, startDestination = start) {
            composable(Routes.LOGIN) {
                LoginScreen(onLoggedIn = {
                    nav.navigate(Routes.QUEUE) { popUpTo(Routes.LOGIN) { inclusive = true } }
                })
            }
            composable(Routes.QUEUE) {
                QueueScreen(
                    onMenu = openDrawer,
                    onOpenFpa = { nav.navigate(Routes.FPA) },
                    onOpenQc = { nav.navigate(Routes.QC) }
                )
            }
            composable(Routes.VERIFY) { VerifyScreen(onMenu = openDrawer) }
            composable(Routes.ISSUES) { IssuesScreen(onMenu = openDrawer) }
            composable(Routes.DASHBOARD) { DashboardScreen(onMenu = openDrawer) }
            composable(Routes.COMPLIANCE) { ComplianceScreen(onMenu = openDrawer) }
            composable(Routes.FPA) { FpaScreen(onBack = { nav.popBackStack() }) }
            composable(Routes.QC) {
                QcEntryScreen(
                    onBack = { nav.popBackStack() },
                    onDoFpa = { nav.navigate(Routes.FPA) }
                )
            }
        }
    }
}

@Composable
private fun DrawerHeader(username: String, line: String) {
    Column(Modifier.padding(24.dp)) {
        Text("JMS Ocean QC", fontWeight = FontWeight.Bold, fontSize = 20.sp,
            color = MaterialTheme.colorScheme.onSurface)
        Text(
            buildString {
                append(if (username.isBlank()) "—" else username)
                if (line.isNotBlank()) append(" · Line $line")
            },
            fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}
