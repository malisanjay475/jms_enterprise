"use client";

import React, { useState, useEffect } from 'react';

interface WipRow {
  factory_unit?: string;
  item_code?: string;
  item_name?: string;
  total_qty?: number;
  uom?: string;
  entries_count?: number;
  stock_date?: string;
  job_no?: string;
  row_status?: string;
}

export default function WipReportPage() {
  const [data, setData] = useState<WipRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    factory_id: '',
    type: 'summary',
    from: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    to: new Date().toISOString().split('T')[0],
    search: '',
  });

  const generateReport = async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams({
        ...filters,
        factory_id: filters.factory_id || '',
      });
      // Replace with your actual V2 Backend URL if running on a specific port
      const res = await fetch(`http://localhost:3000/reports/wip?${queryParams}`);
      const result = await res.json();
      setData(result);
    } catch (err) {
      console.error('Failed to fetch report:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    generateReport();
  }, []);

  return (
    <div className="min-h-screen bg-[#0F172A] text-slate-200 p-8 font-sans">
      <div className="max-w-7xl mx-auto">
        <header className="mb-10 flex justify-between items-center">
          <div>
            <h1 className="text-4xl font-extrabold text-white tracking-tight">WIP Inventory Report</h1>
            <p className="text-slate-400 mt-2">Aggregated factory floor stock and job-card status.</p>
          </div>
          <div className="flex space-x-3">
             <button onClick={() => window.print()} className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-all text-sm font-medium">
               Print PDF
             </button>
             <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-all text-sm font-medium shadow-lg shadow-blue-500/20">
               Export Excel
             </button>
          </div>
        </header>

        {/* Filter Bar */}
        <div className="bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-2xl p-6 mb-8 shadow-xl">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-6 items-end">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Factory Unit</label>
              <select 
                value={filters.factory_id}
                onChange={(e) => setFilters({...filters, factory_id: e.target.value})}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              >
                 <option value="">All Factories</option>
                 <option value="101">Unit #101</option>
                 <option value="105">Unit #105</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Report View</label>
              <div className="flex bg-slate-800 rounded-lg p-1 border border-slate-700">
                <button 
                  onClick={() => setFilters({...filters, type: 'summary'})}
                  className={`flex-1 py-1.5 px-3 rounded-md text-xs font-semibold transition-all ${filters.type === 'summary' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
                >Summary</button>
                <button 
                  onClick={() => setFilters({...filters, type: 'detail'})}
                  className={`flex-1 py-1.5 px-3 rounded-md text-xs font-semibold transition-all ${filters.type === 'detail' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
                >Detail</button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">From Date</label>
              <input 
                type="date"
                value={filters.from}
                onChange={(e) => setFilters({...filters, from: e.target.value})}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">To Date</label>
              <input 
                type="date"
                value={filters.to}
                onChange={(e) => setFilters({...filters, to: e.target.value})}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <button 
              onClick={generateReport}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 rounded-lg transition-all shadow-lg shadow-blue-600/20 active:scale-95"
            >
              Run Report
            </button>
          </div>
        </div>

        {/* Data Grid */}
        <div className="bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
          <div className="p-6 border-b border-slate-800 flex justify-between items-center">
             <h3 className="font-semibold text-white">Stock Data Results</h3>
             <input 
               type="text" 
               placeholder="Search items or job cards..."
               className="bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500/50 w-64"
               value={filters.search}
               onChange={(e) => setFilters({...filters, search: e.target.value})}
             />
          </div>
          
          <div className="overflow-x-auto">
            {loading ? (
              <div className="p-20 text-center animate-pulse text-slate-500">
                Fetching factory data...
              </div>
            ) : data.length === 0 ? (
              <div className="p-20 text-center text-slate-500">
                No data found for the selected filters.
              </div>
            ) : (
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-800/30 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-800">
                  {filters.type === 'summary' ? (
                    <tr>
                      <th className="px-6 py-4">Unit</th>
                      <th className="px-6 py-4">Item Code</th>
                      <th className="px-6 py-4">Item Name</th>
                      <th className="px-6 py-4 text-right">Total Qty</th>
                      <th className="px-6 py-4">UOM</th>
                      <th className="px-6 py-4">Records</th>
                    </tr>
                  ) : (
                    <tr>
                      <th className="px-6 py-4">Date</th>
                      <th className="px-6 py-4">Unit</th>
                      <th className="px-6 py-4">Item Code</th>
                      <th className="px-6 py-4 text-right">Qty</th>
                      <th className="px-6 py-4">Job No</th>
                      <th className="px-6 py-4">Status</th>
                    </tr>
                  )}
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {data.map((row, i) => (
                    <tr key={i} className="hover:bg-blue-500/5 transition-colors group">
                      {filters.type === 'summary' ? (
                         <>
                           <td className="px-6 py-4 text-slate-400">{row.factory_unit}</td>
                           <td className="px-6 py-4 font-mono font-medium text-blue-400">{row.item_code}</td>
                           <td className="px-6 py-4 text-slate-200">{row.item_name}</td>
                           <td className="px-6 py-4 text-right font-bold text-white">{row.total_qty}</td>
                           <td className="px-6 py-4 text-slate-500">{row.uom}</td>
                           <td className="px-6 py-4"><span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px]">{row.entries_count}</span></td>
                         </>
                      ) : (
                        <>
                          <td className="px-6 py-4 text-slate-500 font-mono text-xs">{row.stock_date?.split('T')[0]}</td>
                          <td className="px-6 py-4 text-slate-400">{row.factory_unit}</td>
                          <td className="px-6 py-4 text-blue-400 font-medium">{row.item_code}</td>
                          <td className="px-6 py-4 text-right font-bold text-white">{row.total_qty}</td>
                          <td className="px-6 py-4 font-mono text-slate-400">{row.job_no}</td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${row.row_status === 'Active' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
                              {row.row_status}
                            </span>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
