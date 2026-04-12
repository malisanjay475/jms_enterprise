
// --- ADMIN DELETE MODAL LOGIC (ADD-ON) ---
window.deleteEntry = async (id) => {
    if (!confirm('This entry will be deleted. Are you sure?')) return;
    try {
        const res = await window.JPSMS.api.post('/dpr/delete-entry', { id, session: window.JPSMS.auth.getUser() });
        if (res.ok) {
            alert('Entry Deleted!');
            if (document.getElementById('modal-details')) document.getElementById('modal-details').style.display = 'none';
            if (typeof closeDprEdit === 'function') closeDprEdit();
            // Reload current view
            const applyBtn = document.getElementById('btn-apply');
            if (applyBtn) applyBtn.click();
        } else {
            alert('Error: ' + res.error);
        }
    } catch (e) {
        alert('Request Failed: ' + e.message);
    }
};

window.deleteSetup = async (id) => {
    if (!confirm('This setup will be deleted. Are you sure?')) return;
    try {
        const res = await window.JPSMS.api.post('/dpr/delete-setup', { id, session: window.JPSMS.auth.getUser() });
        if (res.ok) {
            alert('Setup Deleted!');
            // Reload
            const applyBtn = document.getElementById('btn-apply');
            if (applyBtn) applyBtn.click();
        } else {
            alert('Error: ' + res.error);
        }
    } catch (e) {
        alert('Request Failed: ' + e.message);
    }
};

window.deleteSetupFromModal = () => {
     if (!window.currentSetupId) return;
     window.deleteSetup(window.currentSetupId);
     window.currentSetupId = null;
     if (typeof closeJobModal === 'function') closeJobModal();
};

// Correcting showEntryDetails via a global hook (Monkey Patch)
(function() {
    const originalShowEntryDetails = window.showEntryDetails;
    window.showEntryDetails = (entry) => {
        if (typeof originalShowEntryDetails === 'function') originalShowEntryDetails(entry);
        
        // After rendering, inject delete button if admin
        if (window.JPSMS.auth.hasRole('admin')) {
            const container = document.getElementById('modal-details-content');
            if (container && !document.getElementById('btn-delete-entry-inline')) {
                const e = typeof entry === 'string' ? JSON.parse(decodeURIComponent(entry)) : entry;
                const delBtn = document.createElement('div');
                delBtn.style.marginTop = '20px';
                delBtn.style.borderTop = '1px solid #eee';
                delBtn.style.paddingTop = '15px';
                delBtn.style.display = 'flex';
                delBtn.style.gap = '10px';
                delBtn.innerHTML = `
                    <button id="btn-delete-entry-inline" class="btn btn-outline" style="color:#ef4444; border-color:#ef4444; flex:1" onclick="deleteEntry(${e.id})"><i class="bi bi-trash"></i> Delete Entry</button>
                `;
                container.appendChild(delBtn);
            }
        }
    };
})();
