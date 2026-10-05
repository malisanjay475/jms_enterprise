package com.jmsocean.shifting

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.jmsocean.shifting.data.remote.Network
import com.jmsocean.shifting.ui.jobs.JobDetailScreen
import com.jmsocean.shifting.ui.jobs.JobsScreen
import com.jmsocean.shifting.ui.login.LoginScreen
import com.jmsocean.shifting.ui.manual.ManualScreen
import com.jmsocean.shifting.ui.recent.RecentScreen
import com.jmsocean.shifting.ui.scan.ScanScreen
import com.jmsocean.shifting.ui.summary.MyShiftScreen
import com.jmsocean.shifting.ui.team.ShiftTeamScreen
import com.jmsocean.shifting.ui.team.ShiftTeamViewModel
import com.jmsocean.shifting.ui.theme.ShiftingTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            ShiftingTheme {
                Surface(modifier = Modifier.fillMaxSize()) { ShiftingRoot() }
            }
        }
    }
}

private object Routes {
    const val LOGIN = "login"
    const val SCAN = "scan"
    const val MANUAL = "manual"
    const val TEAM = "team"
    const val JOBS = "jobs"
    const val JOB = "job/{planId}"
    const val RECENT = "recent"
    const val SUMMARY = "summary"
    fun job(planId: String) = "job/${android.net.Uri.encode(planId)}"
}

private data class Dest(val route: String, val label: String, val icon: ImageVector)

private val destinations = listOf(
    Dest(Routes.SCAN, "Scan", Icons.Default.QrCodeScanner),
    Dest(Routes.MANUAL, "Manual", Icons.Default.EditNote),
    Dest(Routes.JOBS, "Jobs", Icons.AutoMirrored.Filled.List),
    Dest(Routes.RECENT, "Recent", Icons.Default.History),
    Dest(Routes.SUMMARY, "My Shift", Icons.Default.BarChart)
)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ShiftingRoot() {
    val nav = rememberNavController()
    val app = ShiftingApp.instance
    val scope = rememberCoroutineScope()
    val drawerState = rememberDrawerState(DrawerValue.Closed)

    val backStack by nav.currentBackStackEntryAsState()
    val current = backStack?.destination?.route
    val topLevel = destinations.map { it.route }.toSet() + Routes.TEAM

    // Shift team gate: after login nothing is reachable until the Shifting Supervisor and
    // Incharge of the user's line(s) are saved for the current shift (like the QC app).
    val teamVm: ShiftTeamViewModel = viewModel()
    val team by teamVm.state.collectAsStateWithLifecycle()
    val loggedIn = current != null && current != Routes.LOGIN
    LaunchedEffect(loggedIn) { if (loggedIn) teamVm.load() else teamVm.reset() }
    // A new shift (08:00 / 20:00) while the app is open locks it again.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { if (loggedIn) teamVm.checkShift() }
    val gated = loggedIn && !team.unlocked
    BackHandler(enabled = gated) { /* stay on the shift team screen */ }

    // Logged in = a remembered user AND a live server session cookie.
    val start = if (app.session.isLoggedIn && Network.cookieJar.hasSession(Network.apiHost)) Routes.SCAN else Routes.LOGIN
    val openDrawer: () -> Unit = { scope.launch { drawerState.open() } }

    fun go(route: String) {
        scope.launch { drawerState.close() }
        if (route != current) {
            nav.navigate(route) {
                popUpTo(Routes.SCAN) { inclusive = false }
                launchSingleTop = true
            }
        }
    }

    fun logout() {
        app.repository.logout()
        scope.launch { drawerState.close() }
        nav.navigate(Routes.LOGIN) { popUpTo(0) { inclusive = true } }
    }

    // Any 401 from the server: back to the login screen.
    LaunchedEffect(Unit) {
        app.repository.sessionExpired.collect {
            if (nav.currentDestination?.route != Routes.LOGIN) logout()
        }
    }

    Box(Modifier.fillMaxSize()) {
    ModalNavigationDrawer(
        drawerState = drawerState,
        gesturesEnabled = current in topLevel && !gated,
        drawerContent = {
            ModalDrawerSheet {
                Column(Modifier.padding(24.dp)) {
                    Text("JMS Shifting", fontWeight = FontWeight.Bold, fontSize = 20.sp, color = MaterialTheme.colorScheme.onSurface)
                    Text(
                        buildString {
                            append(app.session.username.ifBlank { "—" })
                            if (app.session.line.isNotBlank()) append(" · Line ${app.session.line}")
                        },
                        fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                HorizontalDivider()
                Spacer(Modifier.height(8.dp))
                destinations.forEach { d ->
                    NavigationDrawerItem(
                        label = { Text(d.label) },
                        icon = { Icon(d.icon, null) },
                        selected = current == d.route,
                        onClick = { go(d.route) },
                        modifier = Modifier.padding(horizontal = 12.dp)
                    )
                }
                NavigationDrawerItem(
                    label = { Text("Shift Team") },
                    icon = { Icon(Icons.Default.Groups, null) },
                    selected = current == Routes.TEAM,
                    onClick = { go(Routes.TEAM) },
                    modifier = Modifier.padding(horizontal = 12.dp)
                )
                Spacer(Modifier.height(8.dp))
                HorizontalDivider()
                NavigationDrawerItem(
                    label = { Text("Log out") },
                    icon = { Icon(Icons.AutoMirrored.Filled.ExitToApp, null) },
                    selected = false,
                    onClick = { logout() },
                    modifier = Modifier.padding(horizontal = 12.dp)
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "App v${BuildConfig.VERSION_NAME} (build ${BuildConfig.VERSION_CODE})",
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
                )
            }
        }
    ) {
        Scaffold(
            containerColor = MaterialTheme.colorScheme.background,
            bottomBar = {
                if (current in topLevel && !gated) {
                    NavigationBar {
                        destinations.forEach { d ->
                            NavigationBarItem(
                                selected = current == d.route,
                                onClick = { go(d.route) },
                                icon = { Icon(d.icon, null) },
                                label = { Text(d.label) }
                            )
                        }
                    }
                }
            }
        ) { pad ->
            NavHost(
                navController = nav,
                startDestination = start,
                // each screen has its own top bar; don't add the status-bar gap twice
                modifier = Modifier.padding(pad).consumeWindowInsets(pad)
            ) {
                composable(Routes.LOGIN) {
                    LoginScreen(onLoggedIn = {
                        nav.navigate(Routes.SCAN) { popUpTo(Routes.LOGIN) { inclusive = true } }
                    })
                }
                composable(Routes.SCAN) { ScanScreen(onMenu = openDrawer) }
                composable(Routes.MANUAL) { ManualScreen(onMenu = openDrawer) }
                composable(Routes.TEAM) { ShiftTeamScreen(vm = teamVm, gate = false, onMenu = openDrawer) }
                composable(Routes.JOBS) { JobsScreen(onMenu = openDrawer, onOpenJob = { nav.navigate(Routes.job(it)) }) }
                composable(Routes.JOB, arguments = listOf(navArgument("planId") { type = NavType.StringType })) {
                    JobDetailScreen(onBack = { nav.popBackStack() })
                }
                composable(Routes.RECENT) { RecentScreen(onMenu = openDrawer) }
                composable(Routes.SUMMARY) { MyShiftScreen(onMenu = openDrawer) }
            }
        }
    }
    // Full-screen lock on top of everything (its Scaffold surface swallows touches).
    if (gated) ShiftTeamScreen(vm = teamVm, gate = true, onLogout = { logout() })
    } // Box
}
