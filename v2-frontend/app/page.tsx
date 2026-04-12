import React from 'react';

export default function SuperadminDashboard() {
  return (
    <div className="min-h-screen bg-[#0F172A] text-slate-200 font-sans selection:bg-blue-500/30">
      {/* 10/10 Enterprise UI: Dark Mode, Glassmorphism, Clean Spacing */}
      <nav className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded bg-gradient-to-tr from-blue-600 to-cyan-400 flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/20">
            JMS
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-white">Master Control</h1>
        </div>
          <div className="flex items-center space-x-2">
            <a href="/reports/wip" className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors">
              Reports
            </a>
            <button className="px-4 py-2 text-sm font-medium text-white transition-all bg-indigo-600 rounded-md hover:bg-indigo-500 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-900 shadow-lg shadow-indigo-600/20">
              Superadmin
            </button>
          </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <header className="mb-8 flex justify-between items-end">
          <div>
            <h2 className="text-3xl font-bold text-white tracking-tight">Global Factory Sync Status</h2>
            <p className="mt-2 text-slate-400">Real-time metrics aggregated via BullMQ Engine</p>
          </div>
          <button className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors flex items-center space-x-1">
            <span>View All Logs &rarr;</span>
          </button>
        </header>

        {/* Dashboard Grid Map */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Active Factory Card */}
          <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-6 backdrop-blur-sm hover:border-blue-500/30 transition-all group">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-medium text-white">Factory #101</h3>
              <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Healthy
              </span>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Last Sync</span>
                <span className="text-slate-200 font-medium font-mono">2s ago</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Pending Queue</span>
                <span className="text-slate-200 font-medium">0 items</span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-1.5 mt-2 overflow-hidden">
                <div className="bg-blue-500 h-1.5 rounded-full w-[100%] shadow-[0_0_10px_rgba(59,130,246,0.6)]"></div>
              </div>
            </div>
          </div>

          {/* Slower Factory Card */}
          <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-6 backdrop-blur-sm hover:border-amber-500/30 transition-all group">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-medium text-white">Factory #105</h3>
              <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                Lagging
              </span>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Last Sync</span>
                <span className="text-slate-200 font-medium font-mono">14m ago</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Pending Queue</span>
                <span className="text-slate-200 font-medium">85 items</span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-1.5 mt-2 overflow-hidden">
                <div className="bg-amber-400 h-1.5 rounded-full w-[65%] shadow-[0_0_10px_rgba(251,191,36,0.6)]"></div>
              </div>
            </div>
          </div>

          {/* Offline/DLQ Factory Card */}
          <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-6 backdrop-blur-sm hover:border-red-500/30 transition-all group relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/5 rounded-full blur-3xl -mr-10 -mt-10"></div>
            <div className="flex justify-between items-start mb-4 relative z-10">
              <h3 className="text-lg font-medium text-white flex items-center">
                Factory #112 
              </h3>
              <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-500 border border-red-500/20 animate-pulse">
                Offline DLQ
              </span>
            </div>
            <div className="space-y-3 relative z-10">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Last Sync</span>
                <span className="text-red-400 font-medium font-mono">5h ago</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Pending Queue</span>
                <span className="text-slate-200 font-medium">4,201 items</span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-1.5 mt-2 overflow-hidden">
                <div className="bg-red-500 h-1.5 rounded-full w-[10%] shadow-[0_0_10px_rgba(239,68,68,0.6)]"></div>
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
