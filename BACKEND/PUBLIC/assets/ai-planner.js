(function () {
    // Wait for JPSMS and DOM
    window.addEventListener('DOMContentLoaded', () => {
        const btn = document.getElementById('btnAiOptimize');
        if (btn) {
            btn.addEventListener('click', requestSmartPlan);
        }
    });

    async function requestSmartPlan() {
        const { toast, api } = window.JPSMS;

        // 1. Show Loading
        toast('AI Smart Planner is Thinking... 🧠', 'info');
        const originalText = document.getElementById('btnAiOptimize').innerHTML;
        document.getElementById('btnAiOptimize').innerHTML = '<i class="bi bi-hourglass-split"></i> Thinking...';
        document.getElementById('btnAiOptimize').disabled = true;

        try {
            // 2. Fetch Plan
            const res = await api.post('/ai/plan', {});

            if (!res.ok || !res.plan) {
                throw new Error(res.error || 'No plan returned');
            }

            // 3. Transform Data for Preview Modal
            // AI returns: [{ machine_id, work_order_id, planned_qty, reason }]
            // Preview expects: [{ machine_id, machine_code, building, line, orders: [string] }]

            const assignments = [];
            const machinesMap = new Map((window.lastMachines || []).map(m => [Number(m.id), m]));

            res.plan.forEach(p => {
                const m = machinesMap.get(Number(p.machine_id));
                if (m) {
                    assignments.push({
                        machine_id: m.id,
                        machine_code: m.code,
                        building: m.building,
                        line: m.line,
                        orders: [`${p.work_order_id} (${p.planned_qty})`]
                    });
                }
            });

            if (assignments.length === 0) {
                toast('AI could not find any optimal moves.', 'warning');
            } else {
                toast(`AI suggested ${assignments.length} moves! 🚀`, 'success');

                // Set Global for Commit
                window.lastPreviewAssignments = assignments;
                window.previewMode = 'balance'; // Use balance mode for commit endpoint compat

                // Open Modal
                if (typeof window.showPreview === 'function') {
                    window.showPreview('AI Smart Plan (Gemini Flash)', assignments);
                } else {
                    console.error('showPreview function not found');
                }
            }

        } catch (e) {
            console.error(e);
            toast('AI Planning Failed: ' + e.message, 'error');
        } finally {
            // Restore Button
            document.getElementById('btnAiOptimize').innerHTML = originalText;
            document.getElementById('btnAiOptimize').disabled = false;
        }
    }
})();
