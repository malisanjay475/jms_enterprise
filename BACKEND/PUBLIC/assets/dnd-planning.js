/**
 * Planning Board Drag and Drop Logic
 * Robust implementation using Global Event Delegation
 */

console.log('[DnD] Module Loaded');

// --- Configuration ---
const DND_DEBUG = true;
const HIGHLIGHT_CLASS = 'drag-over';
const DROPPABLE_SELECTOR = '.timeline-track';
const DRAGGABLE_SELECTOR = '.timeline-card';

// --- State ---
let dragSrcEl = null;
let dragPlanId = null;
let dragSrcMachine = null;

// --- Debug Helper ---
function logDnD(msg) {
    if (!DND_DEBUG) return;
    let el = document.getElementById('dnd-status');
    if (!el) {
        el = document.createElement('div');
        el.id = 'dnd-status';
        el.style.cssText = 'position:fixed; bottom:10px; left:10px; background:rgba(0,0,0,0.8); color:#ffdd00; padding:5px 10px; border-radius:4px; z-index:9999; font-size:12px; font-family:monospace; pointer-events:none; box-shadow:0 2px 10px rgba(0,0,0,0.5)';
        document.body.appendChild(el);
    }
    const time = new Date().toLocaleTimeString();
    el.textContent = `[${time}] ${msg}`;
    console.log('[DnD]', msg);

    // Auto-hide after 3s
    clearTimeout(el.to);
    el.style.opacity = '1';
    el.to = setTimeout(() => el.style.opacity = '0', 3000);
}

// --- Event Handlers ---

function handleDragStart(e) {
    let target = e.target;
    // Handle text nodes or internal elements (icons etc)
    if (target.nodeType === 3) target = target.parentNode;
    if (!target.closest) return; // Not an element

    const card = target.closest(DRAGGABLE_SELECTOR);
    if (!card) return;

    // Get Data
    const planId = card.getAttribute('data-pid');
    const machine = card.getAttribute('data-machine');

    if (!planId) {
        logDnD('Error: Card has no Plan ID');
        return;
    }

    logDnD(`Drag Start: ${planId} (${machine})`);

    // --- Custom Ghost Image (Animation Effect) ---
    const ghost = card.cloneNode(true);
    ghost.style.position = 'absolute';
    ghost.style.top = '-9999px';
    ghost.style.left = '-9999px';
    ghost.style.width = card.offsetWidth + 'px';
    ghost.style.height = card.offsetHeight + 'px';
    ghost.style.transform = 'rotate(4deg) scale(1.05)';
    ghost.style.boxShadow = '0 15px 30px rgba(0,0,0,0.3)';
    ghost.style.opacity = '1';
    ghost.style.background = '#fff';
    ghost.style.zIndex = '9999';
    ghost.style.borderRadius = '8px';
    ghost.style.pointerEvents = 'none'; // Vital
    document.body.appendChild(ghost);

    // Center the grab
    e.dataTransfer.setDragImage(ghost, card.offsetWidth / 2, card.offsetHeight / 2);

    // Cleanup ghost after browser grabs it
    setTimeout(() => document.body.removeChild(ghost), 0);
    // ---------------------------------------------

    // Set State
    dragSrcEl = card;
    dragPlanId = planId;
    dragSrcMachine = machine;

    // Visuals (Defer to allow browser to grab ghost image first)
    // We wait 10ms to ensure the browser captures the element at full opacity
    setTimeout(() => {
        card.classList.add('dragging');
        card.style.opacity = '0.5';
        card.style.border = '2px dashed #94a3b8';
        card.style.background = '#f8fafc';
    }, 10);

    // DataTransfer
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', planId);
    e.dataTransfer.setData('application/json', JSON.stringify({ pid: planId, src: machine }));
}

function handleDragEnd(e) {
    if (dragSrcEl) {
        dragSrcEl.classList.remove('dragging');
        dragSrcEl.style.opacity = '1';
    }
    // Cleanup Check
    document.querySelectorAll('.' + HIGHLIGHT_CLASS).forEach(el => el.classList.remove(HIGHLIGHT_CLASS));

    dragSrcEl = null;
    dragPlanId = null;
    logDnD('Drag End');
}

function handleDragOver(e) {
    let target = e.target;
    if (target.nodeType === 3) target = target.parentNode;

    const track = target.closest(DROPPABLE_SELECTOR);
    if (track) {
        // Crucial: allow drop
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        const targetMachine = track.getAttribute('data-machine');

        // Highlight only valid targets (different machine)
        if (targetMachine !== dragSrcMachine) {
            track.classList.add(HIGHLIGHT_CLASS);
        }
    }
}

function handleDragLeave(e) {
    let target = e.target;
    if (target.nodeType === 3) target = target.parentNode;

    const track = target.closest(DROPPABLE_SELECTOR);
    // Only remove if we really left the track (not just entered a child)
    if (track && !track.contains(e.relatedTarget)) {
        track.classList.remove(HIGHLIGHT_CLASS);
    }
}

function handleDrop(e) {
    let target = e.target;
    if (target.nodeType === 3) target = target.parentNode;

    const track = target.closest(DROPPABLE_SELECTOR);
    if (!track) return;

    e.preventDefault(); // Stop redirect
    e.stopPropagation();

    track.classList.remove(HIGHLIGHT_CLASS);

    const targetMachine = track.getAttribute('data-machine');

    logDnD(`Dropped on: ${targetMachine}`);

    if (!targetMachine || targetMachine === dragSrcMachine) {
        logDnD('Drop ignored (same machine or invalid)');
        return;
    }

    if (!dragPlanId) {
        // Use dataTransfer as fallback
        dragPlanId = e.dataTransfer.getData('text/plain');
    }

    confirmMove(dragPlanId, dragSrcMachine, targetMachine);
}

// --- Modal Logic (Self-Healing) ---

function getOrCreateModal() {
    let modal = document.getElementById('moveConfirmModal');
    if (modal) return modal;

    console.warn('[DnD] Modal missing, creating dynamically...');
    const div = document.createElement('div');
    div.id = 'moveConfirmModal';
    div.className = 'modal-overlay';
    div.style.cssText = 'display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:10000; align-items:center; justify-content:center;';

    div.innerHTML = `
    <div style="background:#fff; padding:24px; border-radius:12px; width:400px; box-shadow:0 10px 25px rgba(0,0,0,0.2); text-align:center">
      <div style="font-size:18px; font-weight:600; margin-bottom:12px; color:#1e293b">Confirm Move</div>
      <div id="moveConfirmText" style="margin-bottom:24px; color:#64748b; line-height:1.5">Are you sure?</div>
      <div style="display:flex; justify-content:center; gap:12px">
        <button class="btn" onclick="window.closeMoveConfirm()" style="padding:8px 20px; border:1px solid #e2e8f0; border-radius:6px; background:#fff; color:#475569; cursor:pointer">Cancel</button>
        <button class="btn primary" onclick="window.commitMove()" style="padding:8px 20px; border-radius:6px; background:#3b82f6; color:#fff; border:none; cursor:pointer">Confirm Move</button>
      </div>
    </div>`;

    document.body.appendChild(div);
    return div;
}

function confirmMove(pid, src, target) {
    // Get or Create Modal
    const modal = getOrCreateModal();

    // Set Global State for Confirm Action
    window.pendingMove = { pid, target };

    const txt = modal.querySelector('#moveConfirmText');
    if (txt) txt.textContent = `Move plan from ${src} to ${target}?`;

    // Show Modal
    modal.classList.add('show');
    modal.style.display = 'flex'; // Force visibility
}

// Make explicit global functions for the Modal Buttons
window.closeMoveConfirm = function () {
    const modal = document.getElementById('moveConfirmModal');
    if (modal) {
        modal.classList.remove('show');
        modal.style.display = 'none';
    }
    window.pendingMove = null;
};


window.commitMove = async function () {
    if (!window.pendingMove) return;
    const { pid, target } = window.pendingMove;

    const btn = document.querySelector('#moveConfirmModal .btn.primary');
    const originalText = btn ? btn.innerText : 'Confirm';
    if (btn) { btn.innerText = 'Moving...'; btn.disabled = true; }

    try {
        const api = (window.JPSMS && window.JPSMS.api) ? window.JPSMS.api : (window.api || null);
        if (!api) throw new Error('API client not found');

        const res = await api.post('/planning/move', {
            rowId: pid,
            newMachine: target
        });

        if (res.ok) {
            logDnD('Move Success!');
            if (window.toast) window.toast('Plan moved successfully');
            closeMoveConfirm();

            // Refresh
            if (typeof window.loadTimeline === 'function') {
                window.loadTimeline();
            } else {
                window.location.reload();
            }
        } else {
            throw new Error(res.error || 'Server error');
        }
    } catch (e) {
        alert('Move Failed: ' + e.message);
        logDnD('Error: ' + e.message);
        closeMoveConfirm();
    } finally {
        if (btn) { btn.innerText = originalText; btn.disabled = false; }
    }
};

// --- Initialization ---

function initDnD() {
    // Attach listeners to Document (Delegation)
    document.addEventListener('dragstart', handleDragStart);
    document.addEventListener('dragend', handleDragEnd);
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('drop', handleDrop);

    // Verify Modal
    const modal = document.getElementById('moveConfirmModal');
    if (modal) {
        logDnD('Ready (Modal Found)');
    } else {
        logDnD('Error: Modal NOT Found');
        console.error('DnD Error: #moveConfirmModal not found in DOM');
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDnD);
} else {
    initDnD();
}
