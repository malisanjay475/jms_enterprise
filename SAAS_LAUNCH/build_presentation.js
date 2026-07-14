const pptxgen = require("pptxgenjs");

// ─── BRAND PALETTE ────────────────────────────────────────────────────────────
const C = {
  navy:      "0A1628",   // deep navy – dark slide BG
  navyMid:   "0D1E35",   // slightly lighter navy
  blue:      "1E6FFF",   // electric blue – accent headings
  blueDark:  "1258CC",   // darker blue for contrast
  orange:    "FF6B35",   // highlight / CTA
  orangeLight:"FFF0EB",  // tint for orange boxes
  white:     "FFFFFF",
  offWhite:  "F8FAFF",
  black:     "111827",
  muted:     "64748B",
  green:     "22C55E",
  greenBg:   "F0FDF4",
  red:       "EF4444",
  redBg:     "FEF2F2",
  lightBlue: "EFF6FF",
  cardBg:    "F8FAFC",
};

const makeShadow = () => ({
  type: "outer", color: "000000", blur: 8, offset: 2, angle: 45, opacity: 0.10
});

const makeCardShadow = () => ({
  type: "outer", color: "0A1628", blur: 12, offset: 3, angle: 45, opacity: 0.08
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function addBrandFooter(slide, lightBg = false) {
  const txtColor = lightBg ? C.muted : "FFFFFF";
  const opacity  = lightBg ? 1 : 0.5;
  slide.addText("FlowMES  |  IndustrIQ Technologies", {
    x: 0.3, y: 5.32, w: 6, h: 0.22,
    fontSize: 7.5, color: txtColor, fontFace: "Calibri",
    transparency: lightBg ? 0 : 40,
  });
  slide.addText("demo.flowmes.com", {
    x: 7.5, y: 5.32, w: 2.2, h: 0.22,
    fontSize: 7.5, color: txtColor, align: "right", fontFace: "Calibri",
    transparency: lightBg ? 0 : 40,
  });
}

function addSlideTitle(slide, title, subtitle = null) {
  slide.addText(title, {
    x: 0.45, y: 0.28, w: 9.1, h: 0.52,
    fontSize: 26, bold: true, color: C.black, fontFace: "Calibri",
    margin: 0,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.45, y: 0.82, w: 9.1, h: 0.28,
      fontSize: 13, color: C.muted, fontFace: "Calibri", margin: 0,
    });
  }
  // divider shape under title
  slide.addShape("rect", {
    x: 0.45, y: 1.14, w: 1.6, h: 0.05,
    fill: { color: C.blue }, line: { color: C.blue, width: 0 },
  });
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
const pres = new pptxgen();
pres.layout  = "LAYOUT_16x9";
pres.title   = "FlowMES — Manufacturing Execution System";
pres.author  = "IndustrIQ Technologies";
pres.subject = "CEO Presentation 2025";

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 1 — COVER
// ═══════════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.navy };

  // Large geometric accent circle top-right
  s.addShape("ellipse", {
    x: 7.8, y: -1.2, w: 4.5, h: 4.5,
    fill: { color: C.blue, transparency: 88 },
    line: { color: C.blue, width: 0 },
  });
  s.addShape("ellipse", {
    x: 8.4, y: -0.5, w: 2.8, h: 2.8,
    fill: { color: C.orange, transparency: 90 },
    line: { color: C.orange, width: 0 },
  });
  // Bottom-left accent
  s.addShape("ellipse", {
    x: -1.0, y: 3.8, w: 3.5, h: 3.5,
    fill: { color: C.blue, transparency: 90 },
    line: { color: C.blue, width: 0 },
  });

  // Orange tag above product name
  s.addShape("roundRect", {
    x: 0.65, y: 1.02, w: 2.05, h: 0.32,
    fill: { color: C.orange }, line: { color: C.orange, width: 0 }, rectRadius: 0.05,
  });
  s.addText("MANUFACTURING  ERP", {
    x: 0.65, y: 1.02, w: 2.05, h: 0.32,
    fontSize: 8, bold: true, color: C.white, align: "center",
    fontFace: "Calibri", margin: 0, charSpacing: 1.5,
  });

  // Main product name
  s.addText("FlowMES", {
    x: 0.55, y: 1.42, w: 9, h: 1.35,
    fontSize: 80, bold: true, color: C.white, fontFace: "Calibri", margin: 0,
  });

  // Blue underline accent
  s.addShape("rect", {
    x: 0.62, y: 2.72, w: 3.6, h: 0.07,
    fill: { color: C.blue }, line: { color: C.blue, width: 0 },
  });

  // Tagline
  s.addText("Your Factory. Fully Intelligent.", {
    x: 0.62, y: 2.88, w: 8, h: 0.45,
    fontSize: 20, color: C.white, fontFace: "Calibri",
    transparency: 10, margin: 0,
  });

  // Sub description
  s.addText("End-to-End Manufacturing Execution System for Indian Factories", {
    x: 0.62, y: 3.38, w: 7.5, h: 0.30,
    fontSize: 12.5, color: C.white, fontFace: "Calibri",
    transparency: 35, margin: 0,
  });

  // Bottom bar
  s.addShape("rect", {
    x: 0, y: 5.05, w: 10, h: 0.575,
    fill: { color: C.blue, transparency: 15 },
    line: { color: C.blue, width: 0 },
  });
  s.addText("IndustrIQ Technologies", {
    x: 0.4, y: 5.09, w: 4.5, h: 0.48,
    fontSize: 11, bold: true, color: C.white, fontFace: "Calibri",
    valign: "middle", margin: 0,
  });
  s.addText("Confidential Presentation  |  2025", {
    x: 5.5, y: 5.09, w: 4.1, h: 0.48,
    fontSize: 10, color: C.white, fontFace: "Calibri",
    align: "right", valign: "middle", margin: 0, transparency: 20,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 2 — THE PROBLEM
// ═══════════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  addSlideTitle(s, "What Every Factory Struggles With Today",
    "4 critical problems costing you money every single day");

  const cards = [
    { icon: "📋", title: "Paper Chaos",        body: "Production data on registers, WhatsApp messages, and Excel sheets. No single source of truth.",   x: 0.35, y: 1.3 },
    { icon: "👁",  title: "Zero Visibility",   body: "Factory owners and CEOs have no real-time view of what's happening on the floor right now.",       x: 5.15, y: 1.3 },
    { icon: "📅", title: "Planning Breakdowns", body: "Scheduling jobs across machines is manual. Delays cascade. Customer deadlines are missed.",       x: 0.35, y: 3.0 },
    { icon: "⚠️", title: "Quality Escapes",    body: "Defects are caught too late — after dispatch, not during production. Customer complaints pile up.", x: 5.15, y: 3.0 },
  ];

  for (const c of cards) {
    // card bg
    s.addShape("roundRect", {
      x: c.x, y: c.y, w: 4.45, h: 1.55,
      fill: { color: C.cardBg },
      line: { color: "E2E8F0", width: 1 },
      shadow: makeCardShadow(),
      rectRadius: 0.12,
    });
    // icon circle
    s.addShape("ellipse", {
      x: c.x + 0.20, y: c.y + 0.32, w: 0.55, h: 0.55,
      fill: { color: C.lightBlue }, line: { color: C.lightBlue, width: 0 },
    });
    s.addText(c.icon, {
      x: c.x + 0.20, y: c.y + 0.30, w: 0.55, h: 0.55,
      fontSize: 16, align: "center", valign: "middle", margin: 0,
    });
    // title
    s.addText(c.title, {
      x: c.x + 0.88, y: c.y + 0.18, w: 3.4, h: 0.32,
      fontSize: 13, bold: true, color: C.black, fontFace: "Calibri", margin: 0,
    });
    // body
    s.addText(c.body, {
      x: c.x + 0.88, y: c.y + 0.50, w: 3.38, h: 0.88,
      fontSize: 10.5, color: C.muted, fontFace: "Calibri",
      wrap: true, valign: "top", margin: 0,
    });
  }

  // Bottom stat banner
  s.addShape("roundRect", {
    x: 0.35, y: 4.66, w: 9.3, h: 0.50,
    fill: { color: C.orange }, line: { color: C.orange, width: 0 }, rectRadius: 0.08,
  });
  s.addText("Average factory loses 15–20% of productivity to these problems every month", {
    x: 0.35, y: 4.66, w: 9.3, h: 0.50,
    fontSize: 12.5, bold: true, color: C.white, align: "center",
    fontFace: "Calibri", valign: "middle", margin: 0,
  });

  addBrandFooter(s, true);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 3 — INTRODUCING FLOWMES (hub & spoke)
// ═══════════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.navy };

  // Title
  s.addText("Introducing FlowMES", {
    x: 0.4, y: 0.22, w: 9.2, h: 0.55,
    fontSize: 28, bold: true, color: C.white, fontFace: "Calibri", margin: 0,
  });
  s.addText("One Platform. Every Department. Real-Time.", {
    x: 0.4, y: 0.78, w: 9.2, h: 0.30,
    fontSize: 13.5, color: C.blue, fontFace: "Calibri", margin: 0,
  });

  // Centre hub
  const cx = 5.0, cy = 3.05, hubR = 0.70;
  s.addShape("ellipse", {
    x: cx - hubR, y: cy - hubR, w: hubR * 2, h: hubR * 2,
    fill: { color: C.blue }, line: { color: C.blue, width: 0 },
    shadow: { type: "outer", color: C.blue, blur: 20, offset: 0, angle: 45, opacity: 0.50 },
  });
  s.addText("Flow\nMES", {
    x: cx - hubR, y: cy - hubR + 0.05, w: hubR * 2, h: hubR * 2 - 0.05,
    fontSize: 17, bold: true, color: C.white, align: "center",
    valign: "middle", fontFace: "Calibri", margin: 0,
  });

  // Spoke nodes
  const nodes = [
    { label: "Production\nPlanning",   angle: 270, dist: 1.85 },
    { label: "Daily Production\nReport (DPR)", angle: 315, dist: 2.00 },
    { label: "Quality\nControl",       angle: 0,   dist: 1.90 },
    { label: "HR &\nAttendance",       angle: 45,  dist: 2.00 },
    { label: "Supervisor\nDashboard",  angle: 90,  dist: 1.85 },
    { label: "Purchase\n& GRN",        angle: 135, dist: 2.00 },
    { label: "Barcode\nScanning",      angle: 180, dist: 1.90 },
    { label: "Mobile\nAccess",         angle: 225, dist: 2.00 },
  ];

  for (const n of nodes) {
    const rad = (n.angle * Math.PI) / 180;
    const nx  = cx + n.dist * Math.cos(rad);
    const ny  = cy + n.dist * Math.sin(rad);
    const nw  = 1.45, nh = 0.70;

    // spoke line from hub edge to node
    const lineStartX = cx + hubR * 0.85 * Math.cos(rad);
    const lineStartY = cy + hubR * 0.85 * Math.sin(rad);
    const lineEndX   = nx + (nw / 2) * (-Math.cos(rad));
    const lineEndY   = ny + (nh / 2) * (-Math.sin(rad));
    s.addShape("line", {
      x: Math.min(lineStartX, lineEndX),
      y: Math.min(lineStartY, lineEndY),
      w: Math.abs(lineEndX - lineStartX) || 0.01,
      h: Math.abs(lineEndY - lineStartY) || 0.01,
      line: { color: C.blue, width: 1.5, transparency: 55 },
    });

    // node pill
    s.addShape("roundRect", {
      x: nx - nw / 2, y: ny - nh / 2, w: nw, h: nh,
      fill: { color: C.navyMid },
      line: { color: C.blue, width: 1.2 },
      rectRadius: 0.10,
    });
    s.addText(n.label, {
      x: nx - nw / 2, y: ny - nh / 2, w: nw, h: nh,
      fontSize: 9.5, color: C.white, align: "center", valign: "middle",
      fontFace: "Calibri", margin: 2,
    });
  }

  // Bottom text
  s.addText("Built specifically for Indian manufacturing — plastic moulding, auto parts, assembly, consumer goods and more", {
    x: 0.4, y: 5.10, w: 9.2, h: 0.28,
    fontSize: 9.5, color: C.white, align: "center",
    fontFace: "Calibri", transparency: 35, margin: 0,
  });
  addBrandFooter(s, false);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 4 — CEO DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  addSlideTitle(s, "CEO & Supervisor Dashboard",
    "See your entire factory in one screen — live, right now");

  // ── Left panel: mock dashboard ─────────────────
  s.addShape("roundRect", {
    x: 0.35, y: 1.22, w: 5.85, h: 3.90,
    fill: { color: C.navy }, line: { color: C.navy, width: 0 },
    shadow: makeCardShadow(), rectRadius: 0.14,
  });

  // Dashboard title bar
  s.addShape("roundRect", {
    x: 0.35, y: 1.22, w: 5.85, h: 0.40,
    fill: { color: C.navyMid }, line: { color: C.navyMid, width: 0 }, rectRadius: 0.14,
  });
  s.addText("FACTORY DASHBOARD  —  LIVE", {
    x: 0.50, y: 1.24, w: 5.5, h: 0.36,
    fontSize: 8, bold: true, color: C.blue, fontFace: "Calibri",
    valign: "middle", margin: 0, charSpacing: 1,
  });

  // Big stat row
  const stats = [
    { val: "12,450", label: "Pieces Today", col: C.green },
    { val: "14",     label: "Active Jobs",  col: C.blue  },
    { val: "1.2%",   label: "Rejection",    col: C.orange },
  ];
  stats.forEach((st, i) => {
    const bx = 0.55 + i * 1.92;
    s.addShape("roundRect", {
      x: bx, y: 1.72, w: 1.72, h: 0.90,
      fill: { color: "0D1E35" }, line: { color: "1A2F4A", width: 1 }, rectRadius: 0.08,
    });
    s.addText(st.val, {
      x: bx, y: 1.76, w: 1.72, h: 0.46,
      fontSize: 22, bold: true, color: st.col, align: "center",
      fontFace: "Calibri", margin: 0,
    });
    s.addText(st.label, {
      x: bx, y: 2.22, w: 1.72, h: 0.30,
      fontSize: 9, color: C.white, align: "center",
      fontFace: "Calibri", margin: 0, transparency: 30,
    });
  });

  // Machine grid label
  s.addText("MACHINE STATUS", {
    x: 0.55, y: 2.74, w: 5.5, h: 0.22,
    fontSize: 8, color: C.muted, fontFace: "Calibri", margin: 0, charSpacing: 1,
  });

  // Machine boxes
  const machineColors = [C.green, C.green, C.orange, C.green, C.green, C.red, C.green, C.green];
  const machineLabels = ["INJ-01","INJ-02","INJ-03","INJ-04","INJ-05","INJ-06","ASM-A","ASM-B"];
  machineColors.forEach((col, i) => {
    const col_ = i % 4;
    const row_ = Math.floor(i / 4);
    const mx = 0.55 + col_ * 1.38;
    const my = 2.98 + row_ * 0.62;
    s.addShape("roundRect", {
      x: mx, y: my, w: 1.28, h: 0.50,
      fill: { color: col, transparency: col === C.green ? 75 : col === C.orange ? 70 : 70 },
      line: { color: col, width: 1.2 }, rectRadius: 0.07,
    });
    s.addText(machineLabels[i], {
      x: mx, y: my, w: 1.28, h: 0.50,
      fontSize: 9, bold: true, color: col, align: "center",
      valign: "middle", fontFace: "Calibri", margin: 0,
    });
  });

  // On-time progress bar bg
  s.addShape("roundRect", {
    x: 0.55, y: 4.26, w: 5.5, h: 0.22,
    fill: { color: "1A2F4A" }, line: { color: "1A2F4A", width: 0 }, rectRadius: 0.05,
  });
  s.addShape("roundRect", {
    x: 0.55, y: 4.26, w: 4.79, h: 0.22,
    fill: { color: C.green }, line: { color: C.green, width: 0 }, rectRadius: 0.05,
  });
  s.addText("On-Time Production  87%", {
    x: 0.55, y: 4.26, w: 5.5, h: 0.22,
    fontSize: 9, bold: true, color: C.white, align: "center",
    valign: "middle", fontFace: "Calibri", margin: 0,
  });

  // ── Right panel: benefits ──────────────────────
  const benefits = [
    { icon: "🟢", text: "Real-time machine-by-machine tracking" },
    { icon: "🔔", text: "Instant alerts for stoppages or rejections" },
    { icon: "📱", text: "Accessible from phone, tablet, laptop — anywhere" },
    { icon: "🔌", text: "No new hardware — runs on existing network" },
  ];
  benefits.forEach((b, i) => {
    const by = 1.38 + i * 0.90;
    s.addShape("roundRect", {
      x: 6.45, y: by, w: 3.20, h: 0.74,
      fill: { color: C.lightBlue },
      line: { color: "DBEAFE", width: 1 },
      shadow: makeCardShadow(),
      rectRadius: 0.10,
    });
    s.addText(b.icon, {
      x: 6.60, y: by + 0.08, w: 0.45, h: 0.55,
      fontSize: 18, align: "center", valign: "middle", margin: 0,
    });
    s.addText(b.text, {
      x: 7.10, y: by + 0.08, w: 2.40, h: 0.58,
      fontSize: 11, color: C.black, fontFace: "Calibri",
      valign: "middle", wrap: true, margin: 0,
    });
  });

  addBrandFooter(s, true);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 5 — PLANNING BOARD
// ═══════════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  addSlideTitle(s, "Smart Planning Board",
    "Schedule, reassign, and track jobs across machines in seconds — not hours");

  // ── Planning grid mockup ───────────────────────
  const gridX = 0.35, gridY = 1.28, gridW = 5.6, gridH = 3.4;
  const colW = [1.1, 1.5, 1.5, 1.5];
  const rowH = 0.52;
  const shifts = ["Morning", "Evening", "Night"];
  const machines = ["INJ-01", "INJ-02", "INJ-03", "INJ-04", "INJ-05"];

  // Header row bg
  s.addShape("roundRect", {
    x: gridX, y: gridY, w: gridW, h: rowH,
    fill: { color: C.navy }, line: { color: C.navy, width: 0 }, rectRadius: 0.08,
  });
  s.addText("Machine", {
    x: gridX + 0.05, y: gridY, w: colW[0], h: rowH,
    fontSize: 9, bold: true, color: C.white, valign: "middle",
    fontFace: "Calibri", margin: 5,
  });
  shifts.forEach((sh, i) => {
    s.addText(sh, {
      x: gridX + colW[0] + i * colW[1] + 0.05, y: gridY, w: colW[i + 1], h: rowH,
      fontSize: 9, bold: true, color: C.white, align: "center",
      valign: "middle", fontFace: "Calibri", margin: 0,
    });
  });

  // Row data
  const jobColors = [C.blue, C.green, C.orange, "8B5CF6", "14B8A6", "EC4899", "F59E0B"];
  const jobData = [
    [["CHAIR-01","Morning"], ["TABLE-02","Evening"], [""]],
    [["LID-05","Morning"], [""], ["GEAR-03","Night"]],
    [[""], ["BOX-07","Evening"], ["RING-02","Night"]],
    [["HANDLE-4","Morning"], ["HANDLE-4","Evening"], [""]],
    [["SEAL-01","Morning"], [""], ["SEAL-01","Night"]],
  ];
  machines.forEach((mach, mi) => {
    const ry = gridY + rowH + mi * rowH;
    const rowBg = mi % 2 === 0 ? C.offWhite : C.white;
    s.addShape("rect", {
      x: gridX, y: ry, w: gridW, h: rowH,
      fill: { color: rowBg }, line: { color: "E2E8F0", width: 0.5 },
    });
    s.addText(mach, {
      x: gridX + 0.06, y: ry, w: colW[0], h: rowH,
      fontSize: 9, bold: true, color: C.black, valign: "middle",
      fontFace: "Calibri", margin: 0,
    });
    jobData[mi].forEach((job, ji) => {
      if (job[0]) {
        const jx = gridX + colW[0] + ji * colW[1] + 0.08;
        const jcol = jobColors[(mi * 3 + ji) % jobColors.length];
        s.addShape("roundRect", {
          x: jx, y: ry + 0.08, w: colW[ji + 1] - 0.16, h: rowH - 0.16,
          fill: { color: jcol, transparency: 80 },
          line: { color: jcol, width: 1 }, rectRadius: 0.06,
        });
        s.addText(job[0], {
          x: jx, y: ry + 0.08, w: colW[ji + 1] - 0.16, h: rowH - 0.16,
          fontSize: 8.5, bold: true, color: jcol, align: "center",
          valign: "middle", fontFace: "Calibri", margin: 0,
        });
      }
    });
  });

  // ── Right: bullets ─────────────────────────────
  const bullets = [
    "Drag-and-drop job scheduling across machines",
    "Shift-wise planning — Morning / Evening / Night",
    "Job priority management with color coding",
    "Auto-alerts when a job falls behind schedule",
    "BOM-linked planning — material availability checked",
  ];
  bullets.forEach((b, i) => {
    const by = 1.35 + i * 0.56;
    s.addShape("ellipse", {
      x: 6.30, y: by + 0.08, w: 0.28, h: 0.28,
      fill: { color: C.blue }, line: { color: C.blue, width: 0 },
    });
    s.addText("✓", {
      x: 6.30, y: by + 0.07, w: 0.28, h: 0.28,
      fontSize: 9, bold: true, color: C.white, align: "center",
      valign: "middle", fontFace: "Calibri", margin: 0,
    });
    s.addText(b, {
      x: 6.68, y: by + 0.04, w: 2.95, h: 0.46,
      fontSize: 11, color: C.black, fontFace: "Calibri",
      valign: "middle", wrap: true, margin: 0,
    });
  });

  // BOM highlight box
  s.addShape("roundRect", {
    x: 6.20, y: 4.18, w: 3.45, h: 0.65,
    fill: { color: C.orange }, line: { color: C.orange, width: 0 }, rectRadius: 0.10,
  });
  s.addText([
    { text: "NEW:  ", options: { bold: true, color: C.white, fontSize: 10 } },
    { text: "BOM Integration — Party-wise & Multi-level Child BOM", options: { color: C.white, fontSize: 10 } },
  ], { x: 6.20, y: 4.18, w: 3.45, h: 0.65, align: "center", valign: "middle", fontFace: "Calibri", margin: 5 });

  addBrandFooter(s, true);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 6 — DPR
// ═══════════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  addSlideTitle(s, "Daily Production Report (DPR)",
    "Operators fill data on the floor. You see it instantly in your office.");

  // LEFT — form mockup
  s.addShape("roundRect", {
    x: 0.35, y: 1.28, w: 4.55, h: 3.85,
    fill: { color: C.navy }, line: { color: C.navy, width: 0 },
    shadow: makeCardShadow(), rectRadius: 0.14,
  });
  s.addShape("roundRect", {
    x: 0.35, y: 1.28, w: 4.55, h: 0.44,
    fill: { color: C.blue }, line: { color: C.blue, width: 0 }, rectRadius: 0.14,
  });
  s.addText("DPR Entry — Floor Operator", {
    x: 0.50, y: 1.29, w: 4.20, h: 0.42,
    fontSize: 11, bold: true, color: C.white, fontFace: "Calibri",
    valign: "middle", margin: 0,
  });

  const formFields = [
    { label: "Machine",   val: "INJ-04"        },
    { label: "Job",       val: "CHAIR-LEG-2024" },
    { label: "Shift",     val: "Morning"        },
    { label: "Produced",  val: "840 pcs"        },
    { label: "Rejected",  val: "12 pcs"         },
    { label: "Downtime",  val: "0 min"          },
  ];
  formFields.forEach((f, i) => {
    const fy = 1.84 + i * 0.50;
    s.addText(f.label, {
      x: 0.55, y: fy, w: 1.40, h: 0.36,
      fontSize: 10, color: C.white, fontFace: "Calibri",
      transparency: 40, valign: "middle", margin: 0,
    });
    s.addShape("roundRect", {
      x: 2.00, y: fy, w: 2.60, h: 0.36,
      fill: { color: "0D1E35" }, line: { color: C.blue, width: 1 }, rectRadius: 0.06,
    });
    s.addText(f.val, {
      x: 2.06, y: fy, w: 2.48, h: 0.36,
      fontSize: 10.5, bold: true, color: C.white, fontFace: "Calibri",
      valign: "middle", margin: 0,
    });
  });

  // Submit button
  s.addShape("roundRect", {
    x: 1.50, y: 4.82, w: 2.20, h: 0.42,
    fill: { color: C.orange }, line: { color: C.orange, width: 0 }, rectRadius: 0.08,
  });
  s.addText("SUBMIT ENTRY", {
    x: 1.50, y: 4.82, w: 2.20, h: 0.42,
    fontSize: 11, bold: true, color: C.white, align: "center",
    fontFace: "Calibri", valign: "middle", margin: 0,
  });

  // RIGHT — what management sees
  s.addText("What Management Sees", {
    x: 5.30, y: 1.28, w: 4.30, h: 0.36,
    fontSize: 15, bold: true, color: C.black, fontFace: "Calibri", margin: 0,
  });

  const mgmtPoints = [
    { icon: "📊", text: "Daily totals per machine, per product, per shift" },
    { icon: "🔍", text: "Rejection analysis with reason codes" },
    { icon: "⏱",  text: "Downtime tracking and automatic alerts" },
    { icon: "📄", text: "Auto-generated PDF reports — one click" },
    { icon: "📈", text: "Compare actual vs planned production" },
  ];
  mgmtPoints.forEach((p, i) => {
    const py = 1.76 + i * 0.66;
    s.addShape("roundRect", {
      x: 5.25, y: py, w: 4.40, h: 0.54,
      fill: { color: C.lightBlue }, line: { color: "DBEAFE", width: 1 },
      rectRadius: 0.08, shadow: makeCardShadow(),
    });
    s.addText(p.icon, {
      x: 5.38, y: py + 0.05, w: 0.40, h: 0.44,
      fontSize: 16, align: "center", valign: "middle", margin: 0,
    });
    s.addText(p.text, {
      x: 5.82, y: py + 0.05, w: 3.70, h: 0.44,
      fontSize: 11, color: C.black, fontFace: "Calibri",
      valign: "middle", margin: 0,
    });
  });

  // Bottom banner
  s.addShape("roundRect", {
    x: 5.25, y: 5.08, w: 4.40, h: 0.30,
    fill: { color: C.navy }, line: { color: C.navy, width: 0 }, rectRadius: 0.06,
  });
  s.addText("Eliminate paper registers forever", {
    x: 5.25, y: 5.08, w: 4.40, h: 0.30,
    fontSize: 10, bold: true, color: C.orange, align: "center",
    fontFace: "Calibri", valign: "middle", margin: 0,
  });

  addBrandFooter(s, true);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 7 — QUALITY CONTROL
// ═══════════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  addSlideTitle(s, "Built-in Quality Control System",
    "Catch defects at the machine — before they reach your customer");

  const columns = [
    {
      title: "QC at Production",
      icon: "🏭",
      color: C.blue,
      lightBg: C.lightBlue,
      items: ["In-process quality checks", "Rejection reason classification", "Per-operator quality scores", "Machine-wise defect log"],
    },
    {
      title: "QC Supervisor View",
      icon: "👁",
      color: "7C3AED",
      lightBg: "F5F3FF",
      items: ["Real-time rejection dashboard", "Machine-wise defect heatmap", "Alert when rejection % crosses limit", "Shift comparison charts"],
    },
    {
      title: "Reports & Traceability",
      icon: "📋",
      color: "059669",
      lightBg: "ECFDF5",
      items: ["Full job quality history", "Customer complaint linkage", "Quality trend charts", "Export to PDF / Excel"],
    },
  ];

  columns.forEach((col, ci) => {
    const cx = 0.30 + ci * 3.22;
    s.addShape("roundRect", {
      x: cx, y: 1.22, w: 3.06, h: 3.90,
      fill: { color: col.lightBg }, line: { color: "E5E7EB", width: 1 },
      shadow: makeCardShadow(), rectRadius: 0.14,
    });
    // header strip
    s.addShape("roundRect", {
      x: cx, y: 1.22, w: 3.06, h: 0.88,
      fill: { color: col.color }, line: { color: col.color, width: 0 }, rectRadius: 0.14,
    });
    s.addText(col.icon, {
      x: cx + 0.12, y: 1.26, w: 0.55, h: 0.80,
      fontSize: 22, align: "center", valign: "middle", margin: 0,
    });
    s.addText(col.title, {
      x: cx + 0.68, y: 1.28, w: 2.22, h: 0.80,
      fontSize: 13, bold: true, color: C.white, fontFace: "Calibri",
      valign: "middle", wrap: true, margin: 0,
    });
    // items
    col.items.forEach((item, ii) => {
      const iy = 2.22 + ii * 0.50;
      s.addShape("ellipse", {
        x: cx + 0.18, y: iy + 0.10, w: 0.18, h: 0.18,
        fill: { color: col.color }, line: { color: col.color, width: 0 },
      });
      s.addText(item, {
        x: cx + 0.45, y: iy, w: 2.45, h: 0.44,
        fontSize: 11, color: C.black, fontFace: "Calibri",
        valign: "middle", wrap: true, margin: 0,
      });
    });
  });

  // Bottom stat
  s.addShape("roundRect", {
    x: 0.30, y: 5.22, w: 9.40, h: 0.36,
    fill: { color: C.navy }, line: { color: C.navy, width: 0 }, rectRadius: 0.08,
  });
  s.addText("Companies using FlowMES QC report 60% reduction in customer rejections", {
    x: 0.30, y: 5.22, w: 9.40, h: 0.36,
    fontSize: 12, bold: true, color: C.orange, align: "center",
    fontFace: "Calibri", valign: "middle", margin: 0,
  });

  addBrandFooter(s, true);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 8 — COMPLETE FACTORY MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  addSlideTitle(s, "Complete Factory Management — Not Just Production",
    "FlowMES covers every department in your factory");

  const modules = [
    {
      icon: "👥", title: "HR Module", color: "7C3AED", bg: "F5F3FF",
      items: ["Attendance tracking", "Performance monitoring", "Interview & hiring panel", "Shift management"],
    },
    {
      icon: "🛒", title: "Purchase & GRN", color: "0284C7", bg: "E0F2FE",
      items: ["Purchase order mgmt", "Vendor management", "Goods Receipt Note (GRN)", "Material stock linking"],
    },
    {
      icon: "📦", title: "Raw Material", color: "059669", bg: "ECFDF5",
      items: ["Job-wise consumption", "Stock level alerts", "Wastage tracking", "BOM vs actual compare"],
    },
    {
      icon: "📊", title: "Reports & Analytics", color: "D97706", bg: "FFFBEB",
      items: ["20+ built-in reports", "Export PDF / Excel", "Date-range filtering", "Production trend charts"],
    },
  ];

  modules.forEach((m, mi) => {
    const mx = 0.28 + mi * 2.40;
    s.addShape("roundRect", {
      x: mx, y: 1.22, w: 2.25, h: 3.85,
      fill: { color: m.bg }, line: { color: "E5E7EB", width: 1 },
      shadow: makeCardShadow(), rectRadius: 0.12,
    });
    // icon circle
    s.addShape("ellipse", {
      x: mx + 0.75, y: 1.36, w: 0.75, h: 0.75,
      fill: { color: m.color }, line: { color: m.color, width: 0 },
    });
    s.addText(m.icon, {
      x: mx + 0.75, y: 1.36, w: 0.75, h: 0.75,
      fontSize: 20, align: "center", valign: "middle", margin: 0,
    });
    s.addText(m.title, {
      x: mx + 0.10, y: 2.18, w: 2.05, h: 0.44,
      fontSize: 12, bold: true, color: m.color, align: "center",
      fontFace: "Calibri", wrap: true, margin: 0,
    });
    m.items.forEach((item, ii) => {
      const iy = 2.70 + ii * 0.50;
      s.addShape("ellipse", {
        x: mx + 0.22, y: iy + 0.13, w: 0.14, h: 0.14,
        fill: { color: m.color }, line: { color: m.color, width: 0 },
      });
      s.addText(item, {
        x: mx + 0.42, y: iy, w: 1.72, h: 0.44,
        fontSize: 10.5, color: C.black, fontFace: "Calibri",
        valign: "middle", wrap: true, margin: 0,
      });
    });
  });

  // Bottom
  s.addShape("roundRect", {
    x: 0.28, y: 5.14, w: 9.44, h: 0.34,
    fill: { color: C.orange }, line: { color: C.orange, width: 0 }, rectRadius: 0.07,
  });
  s.addText("One login. One system. Every department covered.", {
    x: 0.28, y: 5.14, w: 9.44, h: 0.34,
    fontSize: 12, bold: true, color: C.white, align: "center",
    fontFace: "Calibri", valign: "middle", margin: 0,
  });

  addBrandFooter(s, true);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 9 — MOBILE & SCANNER
// ═══════════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.navy };

  s.addText("Works on Every Device", {
    x: 0.4, y: 0.22, w: 9.2, h: 0.55,
    fontSize: 28, bold: true, color: C.white, fontFace: "Calibri", margin: 0,
  });
  s.addText("Including Barcode Scanners — No new hardware needed", {
    x: 0.4, y: 0.78, w: 9.2, h: 0.30,
    fontSize: 13.5, color: C.blue, fontFace: "Calibri", margin: 0,
  });

  const devices = [
    { icon: "📱", label: "Mobile App", sub: "Android & iOS" },
    { icon: "💻", label: "Web Browser", sub: "Any laptop or PC" },
    { icon: "📟", label: "Barcode Scanner", sub: "Handheld scanner support" },
    { icon: "🖨",  label: "Label Printing",  sub: "Barcode label printer" },
    { icon: "📡", label: "Local WiFi Mode", sub: "No internet needed on floor" },
  ];

  devices.forEach((d, i) => {
    const dy = 1.25 + i * 0.74;
    s.addShape("roundRect", {
      x: 0.35, y: dy, w: 4.55, h: 0.62,
      fill: { color: C.navyMid }, line: { color: C.blue, width: 1 }, rectRadius: 0.10,
    });
    s.addShape("ellipse", {
      x: 0.55, y: dy + 0.08, w: 0.46, h: 0.46,
      fill: { color: C.blue, transparency: 80 }, line: { color: C.blue, width: 0 },
    });
    s.addText(d.icon, {
      x: 0.55, y: dy + 0.07, w: 0.46, h: 0.46,
      fontSize: 17, align: "center", valign: "middle", margin: 0,
    });
    s.addText(d.label, {
      x: 1.12, y: dy + 0.06, w: 2.6, h: 0.26,
      fontSize: 12, bold: true, color: C.white, fontFace: "Calibri", margin: 0,
    });
    s.addText(d.sub, {
      x: 1.12, y: dy + 0.32, w: 2.6, h: 0.22,
      fontSize: 9.5, color: C.blue, fontFace: "Calibri", margin: 0,
    });
  });

  // Right: LOCAL MODE box
  s.addShape("roundRect", {
    x: 5.30, y: 1.22, w: 4.35, h: 3.90,
    fill: { color: C.navyMid }, line: { color: C.orange, width: 2 }, rectRadius: 0.16,
  });
  s.addShape("roundRect", {
    x: 5.30, y: 1.22, w: 4.35, h: 0.58,
    fill: { color: C.orange }, line: { color: C.orange, width: 0 }, rectRadius: 0.16,
  });
  s.addText("LOCAL MODE", {
    x: 5.30, y: 1.22, w: 4.35, h: 0.58,
    fontSize: 16, bold: true, color: C.white, align: "center",
    fontFace: "Calibri", valign: "middle", margin: 0, charSpacing: 2,
  });
  s.addText("Works Even Without Internet", {
    x: 5.50, y: 1.92, w: 3.95, h: 0.36,
    fontSize: 14, bold: true, color: C.orange, align: "center",
    fontFace: "Calibri", margin: 0,
  });
  s.addText(
    "FlowMES runs on your factory's own server. Production tracking continues even with zero internet.\n\nWhen the connection restores, data syncs automatically to the cloud — no manual steps required.",
    {
      x: 5.50, y: 2.35, w: 3.95, h: 1.55,
      fontSize: 11.5, color: C.white, fontFace: "Calibri",
      valign: "top", wrap: true, margin: 0, transparency: 15,
    }
  );
  s.addShape("roundRect", {
    x: 5.55, y: 3.98, w: 3.85, h: 0.72,
    fill: { color: C.navy }, line: { color: C.blue, width: 1 }, rectRadius: 0.10,
  });
  s.addText("Scanner Bridge connects handheld barcode\nscanners directly to FlowMES — zero setup", {
    x: 5.55, y: 3.98, w: 3.85, h: 0.72,
    fontSize: 10.5, color: C.white, align: "center", fontFace: "Calibri",
    valign: "middle", margin: 3,
  });

  addBrandFooter(s, false);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 10 — WHY FLOWMES (Comparison)
// ═══════════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  addSlideTitle(s, "Why FlowMES?",
    "Built for Indian manufacturing — not adapted from a foreign product");

  const rows = [
    ["Built for Manufacturing",      "❌  Generic",            "✅  100% Mfg-Focused"],
    ["Setup & Go-Live Time",         "❌  3 – 6 months",       "✅  2 – 3 weeks"],
    ["Works Without Internet",       "❌  No",                 "✅  Yes — Local Mode"],
    ["Barcode Scanner Support",      "❌  Extra cost module",   "✅  Included"],
    ["Mobile App",                   "❌  Limited / extra",    "✅  Full-featured"],
    ["Indian Manufacturing Flows",   "❌  No",                 "✅  DPR, Shifts, Moulding"],
    ["Starting Price",               "❌  ₹10L – ₹50L+",      "✅  From ₹1,50,000"],
  ];

  // Header
  s.addShape("roundRect", {
    x: 0.30, y: 1.28, w: 9.40, h: 0.46,
    fill: { color: C.navy }, line: { color: C.navy, width: 0 }, rectRadius: 0.10,
  });
  ["Feature", "Generic ERP", "FlowMES"].forEach((hdr, i) => {
    const hx = [0.40, 3.80, 6.75][i];
    const hw = [3.20, 2.75, 2.85][i];
    s.addText(hdr, {
      x: hx, y: 1.28, w: hw, h: 0.46,
      fontSize: 12, bold: true, color: i === 2 ? C.orange : C.white,
      fontFace: "Calibri", valign: "middle", margin: 0,
      align: i === 0 ? "left" : "center",
    });
  });

  rows.forEach((row, ri) => {
    const ry = 1.78 + ri * 0.46;
    const rowBg = ri % 2 === 0 ? C.offWhite : C.white;
    s.addShape("rect", {
      x: 0.30, y: ry, w: 9.40, h: 0.44,
      fill: { color: rowBg }, line: { color: "E2E8F0", width: 0.5 },
    });
    s.addText(row[0], {
      x: 0.40, y: ry, w: 3.20, h: 0.44,
      fontSize: 11.5, color: C.black, fontFace: "Calibri", valign: "middle", margin: 0,
    });
    s.addText(row[1], {
      x: 3.80, y: ry, w: 2.75, h: 0.44,
      fontSize: 11, color: C.red, align: "center", fontFace: "Calibri", valign: "middle", margin: 0,
    });
    s.addShape("roundRect", {
      x: 6.70, y: ry + 0.06, w: 2.85, h: 0.32,
      fill: { color: C.greenBg }, line: { color: "BBF7D0", width: 1 }, rectRadius: 0.06,
    });
    s.addText(row[2], {
      x: 6.70, y: ry + 0.06, w: 2.85, h: 0.32,
      fontSize: 11, color: "166534", bold: true, align: "center",
      fontFace: "Calibri", valign: "middle", margin: 0,
    });
  });

  s.addText("Enterprise-grade MES.  Indian pricing.  Factory-floor ready.", {
    x: 0.30, y: 5.14, w: 9.40, h: 0.34,
    fontSize: 13, bold: true, color: C.blue, align: "center",
    fontFace: "Calibri", margin: 0,
  });

  addBrandFooter(s, true);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 11 — ROI
// ═══════════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.navy };

  s.addText("Return on Investment", {
    x: 0.4, y: 0.22, w: 9.2, h: 0.55,
    fontSize: 28, bold: true, color: C.white, fontFace: "Calibri", margin: 0,
  });
  s.addText("FlowMES pays for itself within 60 – 90 days", {
    x: 0.4, y: 0.78, w: 9.2, h: 0.30,
    fontSize: 13.5, color: C.blue, fontFace: "Calibri", margin: 0,
  });

  // LEFT — What You Spend
  s.addShape("roundRect", {
    x: 0.30, y: 1.22, w: 4.15, h: 3.25,
    fill: { color: C.navyMid }, line: { color: C.blue, width: 1.5 }, rectRadius: 0.14,
  });
  s.addText("What You Invest", {
    x: 0.50, y: 1.32, w: 3.75, h: 0.36,
    fontSize: 14, bold: true, color: C.blue, fontFace: "Calibri", margin: 0,
  });
  const spendItems = [
    { label: "One-Time License + Setup", val: "₹3,75,000" },
    { label: "Annual Maintenance (AMC)", val: "₹54,000/yr" },
    { label: "Per Month Equivalent",     val: "₹4,500/mo" },
  ];
  spendItems.forEach((item, i) => {
    const sy = 1.80 + i * 0.70;
    s.addText(item.label, {
      x: 0.50, y: sy, w: 2.50, h: 0.28,
      fontSize: 10.5, color: C.white, transparency: 35,
      fontFace: "Calibri", margin: 0,
    });
    s.addText(item.val, {
      x: 0.50, y: sy + 0.28, w: 3.75, h: 0.34,
      fontSize: 18, bold: true, color: C.white, fontFace: "Calibri", margin: 0,
    });
  });

  // RIGHT — What You Save
  s.addShape("roundRect", {
    x: 4.75, y: 1.22, w: 4.95, h: 3.25,
    fill: { color: C.navyMid }, line: { color: C.green, width: 1.5 }, rectRadius: 0.14,
  });
  s.addText("What You Save Every Month", {
    x: 4.90, y: 1.32, w: 4.60, h: 0.36,
    fontSize: 14, bold: true, color: C.green, fontFace: "Calibri", margin: 0,
  });
  const saveItems = [
    { label: "1 data entry clerk salary",        val: "₹15,000 – ₹20,000" },
    { label: "Production losses from no visibility", val: "₹30,000 – ₹50,000" },
    { label: "Quality rejections reaching customers", val: "₹20,000+" },
    { label: "Planning delays & wrong scheduling",  val: "₹15,000" },
  ];
  saveItems.forEach((item, i) => {
    const sy = 1.80 + i * 0.60;
    s.addShape("ellipse", {
      x: 4.90, y: sy + 0.10, w: 0.20, h: 0.20,
      fill: { color: C.green }, line: { color: C.green, width: 0 },
    });
    s.addText(item.label, {
      x: 5.18, y: sy, w: 3.30, h: 0.28,
      fontSize: 10, color: C.white, transparency: 35,
      fontFace: "Calibri", margin: 0,
    });
    s.addText(item.val, {
      x: 5.18, y: sy + 0.26, w: 3.30, h: 0.28,
      fontSize: 13.5, bold: true, color: C.green, fontFace: "Calibri", margin: 0,
    });
  });

  // Bottom payback box
  s.addShape("roundRect", {
    x: 0.30, y: 4.60, w: 9.40, h: 0.68,
    fill: { color: C.orange }, line: { color: C.orange, width: 0 }, rectRadius: 0.12,
  });
  s.addText([
    { text: "PAYBACK PERIOD: ", options: { bold: true, fontSize: 16, color: C.white } },
    { text: "Less than 60 Days   ", options: { fontSize: 16, color: C.white } },
    { text: " | ", options: { fontSize: 16, color: C.white, transparency: 40 } },
    { text: "  ROI in Year 1: ", options: { bold: true, fontSize: 16, color: C.white } },
    { text: "15x – 25x your investment", options: { fontSize: 16, color: C.white } },
  ], {
    x: 0.30, y: 4.60, w: 9.40, h: 0.68,
    align: "center", valign: "middle", fontFace: "Calibri", margin: 0,
  });

  addBrandFooter(s, false);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 12 — INVESTMENT SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  addSlideTitle(s, "Investment Summary",
    "Transparent. Fixed pricing. No surprises.");

  // Table header
  const cols = ["", "BASIC", "STANDARD", "PROFESSIONAL"];
  const colX = [0.30, 2.85, 5.15, 7.45];
  const colW = [2.45, 2.20, 2.20, 2.20];

  s.addShape("roundRect", {
    x: 0.30, y: 1.28, w: 9.40, h: 0.46,
    fill: { color: C.navy }, line: { color: C.navy, width: 0 }, rectRadius: 0.09,
  });
  cols.forEach((c, i) => {
    s.addText(c, {
      x: colX[i], y: 1.28, w: colW[i], h: 0.46,
      fontSize: 11, bold: true, color: i === 0 ? C.white : C.orange,
      align: i === 0 ? "left" : "center", fontFace: "Calibri",
      valign: "middle", margin: i === 0 ? 8 : 0,
    });
  });

  const tableRows = [
    ["Machines",           "Up to 5",    "Up to 15",   "Up to 30"  ],
    ["Users",              "10",         "30",          "75"         ],
    ["Software License",   "₹1,50,000",  "₹3,00,000",  "₹5,50,000" ],
    ["Implementation",     "₹75,000",    "₹75,000",    "₹75,000"   ],
    ["TOTAL ONE-TIME",     "₹2,25,000",  "₹3,75,000",  "₹6,25,000" ],
    ["AMC Per Year",       "₹27,000",    "₹54,000",    "₹99,000"   ],
  ];

  tableRows.forEach((row, ri) => {
    const ry = 1.78 + ri * 0.44;
    const isTotalRow = row[0].startsWith("TOTAL");
    const rowBg = isTotalRow ? C.lightBlue : ri % 2 === 0 ? C.offWhite : C.white;
    s.addShape("rect", {
      x: 0.30, y: ry, w: 9.40, h: 0.42,
      fill: { color: rowBg }, line: { color: "E2E8F0", width: 0.5 },
    });
    row.forEach((cell, ci) => {
      s.addText(cell, {
        x: colX[ci], y: ry, w: colW[ci], h: 0.42,
        fontSize: isTotalRow ? 12.5 : 11.5,
        bold: isTotalRow || ci > 0,
        color: isTotalRow ? C.blue : ci === 0 ? C.black : C.black,
        align: ci === 0 ? "left" : "center", fontFace: "Calibri",
        valign: "middle", margin: ci === 0 ? 8 : 0,
      });
    });
  });

  // Payment terms
  s.addText("Payment Terms:  40% on Signing  →  40% on Go-Live  →  20% after 30 Days (Satisfaction)", {
    x: 0.30, y: 4.52, w: 9.40, h: 0.30,
    fontSize: 10.5, color: C.muted, align: "center", fontFace: "Calibri", margin: 0,
  });

  // Special offer
  s.addShape("roundRect", {
    x: 0.30, y: 4.88, w: 9.40, h: 0.54,
    fill: { color: C.orange }, line: { color: C.orange, width: 0 }, rectRadius: 0.10,
  });
  s.addText("Special Offer — Year 1 AMC FREE for agreements signed this month", {
    x: 0.30, y: 4.88, w: 9.40, h: 0.54,
    fontSize: 13.5, bold: true, color: C.white, align: "center",
    fontFace: "Calibri", valign: "middle", margin: 0,
  });

  addBrandFooter(s, true);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 13 — NEXT STEPS / CLOSE
// ═══════════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.navy };

  // Accent ellipse
  s.addShape("ellipse", {
    x: 7.5, y: -1.0, w: 4.5, h: 4.5,
    fill: { color: C.blue, transparency: 88 }, line: { color: C.blue, width: 0 },
  });

  s.addText("Let's Get Started", {
    x: 0.4, y: 0.22, w: 9.2, h: 0.55,
    fontSize: 28, bold: true, color: C.white, fontFace: "Calibri", margin: 0,
  });
  s.addText("Your factory can be fully live on FlowMES in 3 weeks", {
    x: 0.4, y: 0.78, w: 9.2, h: 0.30,
    fontSize: 13.5, color: C.blue, fontFace: "Calibri", margin: 0,
  });

  // Timeline
  const steps = [
    { week: "Week 1", label: "Setup &\nConfiguration" },
    { week: "Week 2", label: "Data Entry\n& Training"  },
    { week: "Week 3", label: "Go-Live"                 },
    { week: "Ongoing", label: "AMC\nSupport"           },
  ];
  const arrowY = 1.75;
  steps.forEach((st, i) => {
    const sx = 0.35 + i * 2.32;
    s.addShape("roundRect", {
      x: sx, y: arrowY, w: 2.05, h: 0.88,
      fill: { color: i < 3 ? C.blue : C.orange }, line: { color: i < 3 ? C.blue : C.orange, width: 0 }, rectRadius: 0.10,
    });
    s.addText(st.week, {
      x: sx, y: arrowY + 0.04, w: 2.05, h: 0.28,
      fontSize: 9.5, bold: true, color: C.white, align: "center",
      fontFace: "Calibri", margin: 0, charSpacing: 0.5,
    });
    s.addText(st.label, {
      x: sx, y: arrowY + 0.30, w: 2.05, h: 0.52,
      fontSize: 11, color: C.white, align: "center",
      fontFace: "Calibri", margin: 0, valign: "middle",
    });
    // arrow
    if (i < 3) {
      s.addShape("line", {
        x: sx + 2.08, y: arrowY + 0.44, w: 0.20, h: 0,
        line: { color: C.blue, width: 2.5 },
      });
    }
  });

  // 3 Action boxes
  const actions = [
    { num: "01", title: "Sign Agreement",   body: "We begin server setup within 24 hours of signing" },
    { num: "02", title: "Share Master Data", body: "Send us your products, machines, employees list" },
    { num: "03", title: "Go-Live Date",     body: "We agree on a date — and we deliver on time, guaranteed" },
  ];
  actions.forEach((a, i) => {
    const ax = 0.35 + i * 3.18;
    s.addShape("roundRect", {
      x: ax, y: 2.82, w: 3.00, h: 1.35,
      fill: { color: C.navyMid }, line: { color: C.blue, width: 1 }, rectRadius: 0.12,
    });
    s.addShape("ellipse", {
      x: ax + 0.15, y: 2.92, w: 0.50, h: 0.50,
      fill: { color: C.orange }, line: { color: C.orange, width: 0 },
    });
    s.addText(a.num, {
      x: ax + 0.15, y: 2.92, w: 0.50, h: 0.50,
      fontSize: 14, bold: true, color: C.white, align: "center",
      valign: "middle", fontFace: "Calibri", margin: 0,
    });
    s.addText(a.title, {
      x: ax + 0.75, y: 2.92, w: 2.10, h: 0.30,
      fontSize: 12, bold: true, color: C.white, fontFace: "Calibri", margin: 0,
    });
    s.addText(a.body, {
      x: ax + 0.15, y: 3.44, w: 2.70, h: 0.60,
      fontSize: 10, color: C.white, transparency: 30,
      fontFace: "Calibri", wrap: true, margin: 0,
    });
  });

  // Contact box
  s.addShape("roundRect", {
    x: 0.30, y: 4.28, w: 9.40, h: 0.82,
    fill: { color: C.blue }, line: { color: C.blue, width: 0 }, rectRadius: 0.12,
  });
  s.addText([
    { text: "IndustrIQ Technologies   ", options: { bold: true, fontSize: 13, color: C.white } },
    { text: "  |  ", options: { fontSize: 13, color: C.white, transparency: 40 } },
    { text: "  hello@industiq.com   ", options: { fontSize: 13, color: C.white } },
    { text: "  |  ", options: { fontSize: 13, color: C.white, transparency: 40 } },
    { text: "  www.flowmes.com   ", options: { fontSize: 13, color: C.white } },
    { text: "  |  ", options: { fontSize: 13, color: C.white, transparency: 40 } },
    { text: "  demo.flowmes.com", options: { fontSize: 13, color: C.orange } },
  ], {
    x: 0.30, y: 4.28, w: 9.40, h: 0.82,
    align: "center", valign: "middle", fontFace: "Calibri", margin: 0,
  });

  // Closing tagline
  s.addText("Your Factory. Fully Intelligent. Starting Today.", {
    x: 0.30, y: 5.12, w: 9.40, h: 0.30,
    fontSize: 14, bold: true, color: C.white, align: "center",
    fontFace: "Calibri", margin: 0, transparency: 15, charSpacing: 0.5,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 14 — MACHINE UTILIZATION & OEE
// ═══════════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.navy };

  s.addText("Machine Utilization & OEE Dashboard", {
    x: 0.4, y: 0.22, w: 9.2, h: 0.52,
    fontSize: 26, bold: true, color: C.white, fontFace: "Calibri", margin: 0,
  });
  s.addText("Overall Equipment Effectiveness — Machine Efficiency — Mould Efficiency", {
    x: 0.4, y: 0.76, w: 9.2, h: 0.28,
    fontSize: 13, color: C.blue, fontFace: "Calibri", margin: 0,
  });

  // ── Top KPI row ────────────────────────────────────
  const kpis = [
    { label: "Overall OEE",   val: "82%",  sub: "Target: 85%",   col: C.green  },
    { label: "Availability",  val: "91%",  sub: "Uptime ratio",  col: C.blue   },
    { label: "Performance",   val: "88%",  sub: "Speed ratio",   col: "8B5CF6" },
    { label: "Quality Rate",  val: "97%",  sub: "Good parts",    col: C.orange },
  ];
  kpis.forEach((k, i) => {
    const kx = 0.30 + i * 2.38;
    s.addShape("roundRect", {
      x: kx, y: 1.14, w: 2.18, h: 1.08,
      fill: { color: C.navyMid }, line: { color: k.col, width: 1.5 },
      rectRadius: 0.12,
    });
    s.addText(k.val, {
      x: kx, y: 1.20, w: 2.18, h: 0.58,
      fontSize: 32, bold: true, color: k.col, align: "center",
      fontFace: "Calibri", margin: 0,
    });
    s.addText(k.label, {
      x: kx, y: 1.76, w: 2.18, h: 0.24,
      fontSize: 10, bold: true, color: C.white, align: "center",
      fontFace: "Calibri", margin: 0,
    });
    s.addText(k.sub, {
      x: kx, y: 1.98, w: 2.18, h: 0.18,
      fontSize: 8.5, color: C.white, align: "center",
      fontFace: "Calibri", margin: 0, transparency: 35,
    });
  });

  // ── Machine Efficiency table ────────────────────────
  s.addText("MACHINE EFFICIENCY", {
    x: 0.30, y: 2.36, w: 5.6, h: 0.24,
    fontSize: 9, bold: true, color: C.blue, fontFace: "Calibri",
    margin: 0, charSpacing: 1,
  });

  const machData = [
    { name: "INJ-01", avail: "94%", perf: "89%", qual: "98%", oee: "84%", barW: 4.20 },
    { name: "INJ-02", avail: "88%", perf: "85%", qual: "96%", oee: "72%", barW: 3.60 },
    { name: "INJ-03", avail: "91%", perf: "92%", qual: "99%", oee: "83%", barW: 4.15 },
    { name: "INJ-04", avail: "76%", perf: "80%", qual: "94%", oee: "57%", barW: 2.85 },
    { name: "INJ-05", avail: "95%", perf: "91%", qual: "97%", oee: "84%", barW: 4.20 },
  ];

  // Header
  s.addShape("rect", {
    x: 0.30, y: 2.62, w: 5.65, h: 0.30,
    fill: { color: C.navyMid }, line: { color: C.navyMid, width: 0 },
  });
  ["Machine", "Avail", "Perf", "Quality", "OEE"].forEach((h, hi) => {
    const hxArr = [0.35, 1.25, 1.90, 2.55, 3.30];
    s.addText(h, {
      x: hxArr[hi], y: 2.63, w: hi === 0 ? 0.85 : 0.65, h: 0.28,
      fontSize: 8.5, bold: true, color: C.blue, fontFace: "Calibri", margin: 0,
      align: hi === 0 ? "left" : "center",
    });
  });

  machData.forEach((m, mi) => {
    const ry = 2.94 + mi * 0.40;
    const rowBg = mi % 2 === 0 ? "0D1E35" : C.navyMid;
    s.addShape("rect", {
      x: 0.30, y: ry, w: 5.65, h: 0.38,
      fill: { color: rowBg }, line: { color: "1A2F4A", width: 0.5 },
    });
    const oeeNum = parseInt(m.oee);
    const barColor = oeeNum >= 80 ? C.green : oeeNum >= 65 ? C.orange : C.red;
    [m.name, m.avail, m.perf, m.qual, m.oee].forEach((val, vi) => {
      const vxArr = [0.35, 1.25, 1.90, 2.55, 3.30];
      s.addText(val, {
        x: vxArr[vi], y: ry + 0.04, w: vi === 0 ? 0.85 : 0.65, h: 0.30,
        fontSize: 10, bold: vi === 4,
        color: vi === 4 ? barColor : vi === 0 ? C.white : C.white,
        align: vi === 0 ? "left" : "center",
        fontFace: "Calibri", margin: 0, transparency: vi === 0 ? 0 : 20,
      });
    });
    // OEE bar bg
    s.addShape("roundRect", {
      x: 4.10, y: ry + 0.10, w: 1.70, h: 0.18,
      fill: { color: "1A2F4A" }, line: { color: "1A2F4A", width: 0 }, rectRadius: 0.04,
    });
    s.addShape("roundRect", {
      x: 4.10, y: ry + 0.10, w: (oeeNum / 100) * 1.70, h: 0.18,
      fill: { color: barColor }, line: { color: barColor, width: 0 }, rectRadius: 0.04,
    });
  });

  // ── Mould Efficiency ────────────────────────────────
  s.addShape("roundRect", {
    x: 6.15, y: 2.36, w: 3.55, h: 2.96,
    fill: { color: C.navyMid }, line: { color: "8B5CF6", width: 1.5 }, rectRadius: 0.14,
  });
  s.addShape("roundRect", {
    x: 6.15, y: 2.36, w: 3.55, h: 0.38,
    fill: { color: "8B5CF6" }, line: { color: "8B5CF6", width: 0 }, rectRadius: 0.14,
  });
  s.addText("MOULD EFFICIENCY", {
    x: 6.15, y: 2.36, w: 3.55, h: 0.38,
    fontSize: 10, bold: true, color: C.white, align: "center",
    fontFace: "Calibri", valign: "middle", margin: 0, charSpacing: 1,
  });

  const mouldData = [
    { name: "M-2042", shots: "12,450", cycle: "28s", eff: "91%" },
    { name: "M-1188", shots: "9,820",  cycle: "35s", eff: "84%" },
    { name: "M-0076", shots: "15,200", cycle: "22s", eff: "96%" },
    { name: "M-3301", shots: "7,640",  cycle: "42s", eff: "78%" },
  ];
  mouldData.forEach((md, mi) => {
    const my = 2.86 + mi * 0.58;
    s.addShape("roundRect", {
      x: 6.28, y: my, w: 3.28, h: 0.48,
      fill: { color: "0A1628" }, line: { color: "1A2F4A", width: 1 }, rectRadius: 0.07,
    });
    s.addText(md.name, {
      x: 6.34, y: my + 0.05, w: 0.78, h: 0.38,
      fontSize: 10, bold: true, color: "8B5CF6", fontFace: "Calibri",
      valign: "middle", margin: 0,
    });
    s.addText(`Shots: ${md.shots}`, {
      x: 7.14, y: my + 0.05, w: 1.05, h: 0.38,
      fontSize: 9, color: C.white, fontFace: "Calibri",
      valign: "middle", margin: 0, transparency: 25,
    });
    s.addText(`Cycle: ${md.cycle}`, {
      x: 7.14, y: my + 0.22, w: 1.05, h: 0.20,
      fontSize: 8.5, color: C.blue, fontFace: "Calibri", margin: 0,
    });
    const effNum = parseInt(md.eff);
    const effCol = effNum >= 90 ? C.green : effNum >= 80 ? C.orange : C.red;
    s.addShape("roundRect", {
      x: 9.10, y: my + 0.08, w: 0.38, h: 0.32,
      fill: { color: effCol, transparency: 75 }, line: { color: effCol, width: 1 }, rectRadius: 0.06,
    });
    s.addText(md.eff, {
      x: 9.10, y: my + 0.08, w: 0.38, h: 0.32,
      fontSize: 10, bold: true, color: effCol, align: "center",
      fontFace: "Calibri", valign: "middle", margin: 0,
    });
  });

  // Bottom formula bar
  s.addShape("roundRect", {
    x: 0.30, y: 5.08, w: 9.40, h: 0.36,
    fill: { color: C.navyMid }, line: { color: C.blue, width: 1 }, rectRadius: 0.08,
  });
  s.addText([
    { text: "OEE Formula:  ", options: { bold: true, color: C.blue, fontSize: 11 } },
    { text: "Availability  ×  Performance  ×  Quality  =  True Machine Effectiveness", options: { color: C.white, fontSize: 11 } },
  ], {
    x: 0.30, y: 5.08, w: 9.40, h: 0.36,
    align: "center", valign: "middle", fontFace: "Calibri", margin: 0,
  });

  addBrandFooter(s, false);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 15 — ADVANCED REPORTS & ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  addSlideTitle(s, "Advanced Reports & Analytics",
    "5M Analysis · Tonnage · WIP · Analyze Reports — All built-in");

  // ── LEFT: Analyze Reports ───────────────────────────
  s.addShape("roundRect", {
    x: 0.30, y: 1.26, w: 2.95, h: 3.88,
    fill: { color: "0A1628" }, line: { color: C.blue, width: 1.5 }, rectRadius: 0.14,
  });
  s.addShape("roundRect", {
    x: 0.30, y: 1.26, w: 2.95, h: 0.44,
    fill: { color: C.blue }, line: { color: C.blue, width: 0 }, rectRadius: 0.14,
  });
  s.addText("ANALYZE REPORTS", {
    x: 0.30, y: 1.26, w: 2.95, h: 0.44,
    fontSize: 11, bold: true, color: C.white, align: "center",
    fontFace: "Calibri", valign: "middle", margin: 0, charSpacing: 1,
  });

  const analyzeReports = [
    { icon: "🔩", label: "Machine Wise",    sub: "OEE, downtime, output" },
    { icon: "⚙️", label: "Mould Wise",     sub: "Shots, cycle time, eff" },
    { icon: "👤", label: "Supervisor Wise", sub: "Team output & quality" },
    { icon: "📦", label: "Order Wise",      sub: "Job completion tracking" },
    { icon: "🏭", label: "Plant Wise",      sub: "Cross-plant comparison" },
  ];
  analyzeReports.forEach((r, ri) => {
    const ry = 1.82 + ri * 0.58;
    s.addShape("roundRect", {
      x: 0.44, y: ry, w: 2.64, h: 0.48,
      fill: { color: C.navyMid }, line: { color: "1A2F4A", width: 1 }, rectRadius: 0.08,
    });
    s.addText(r.icon, {
      x: 0.50, y: ry + 0.05, w: 0.36, h: 0.38,
      fontSize: 14, align: "center", valign: "middle", margin: 0,
    });
    s.addText(r.label, {
      x: 0.90, y: ry + 0.04, w: 1.60, h: 0.24,
      fontSize: 10.5, bold: true, color: C.white, fontFace: "Calibri", margin: 0,
    });
    s.addText(r.sub, {
      x: 0.90, y: ry + 0.26, w: 2.10, h: 0.18,
      fontSize: 8.5, color: C.blue, fontFace: "Calibri", margin: 0,
    });
  });

  // ── CENTER: 5M Report ────────────────────────────────
  s.addShape("roundRect", {
    x: 3.50, y: 1.26, w: 3.00, h: 3.88,
    fill: { color: C.lightBlue }, line: { color: "BFDBFE", width: 1 }, rectRadius: 0.14,
  });
  s.addShape("roundRect", {
    x: 3.50, y: 1.26, w: 3.00, h: 0.44,
    fill: { color: C.navy }, line: { color: C.navy, width: 0 }, rectRadius: 0.14,
  });
  s.addText("5M ANALYSIS REPORT", {
    x: 3.50, y: 1.26, w: 3.00, h: 0.44,
    fontSize: 11, bold: true, color: C.orange, align: "center",
    fontFace: "Calibri", valign: "middle", margin: 0, charSpacing: 0.5,
  });

  const fiveMs = [
    { m: "Machine",   desc: "Downtime, OEE, utilization rate", col: C.blue   },
    { m: "Manpower",  desc: "Operator output, attendance, efficiency", col: C.green  },
    { m: "Material",  desc: "Consumption vs BOM, wastage %", col: C.orange },
    { m: "Mould",     desc: "Shots, cycle time, changeover", col: "8B5CF6" },
    { m: "Method",    desc: "Process adherence, rejection causes", col: "14B8A6" },
  ];
  fiveMs.forEach((m5, i) => {
    const my = 1.82 + i * 0.58;
    s.addShape("roundRect", {
      x: 3.62, y: my, w: 2.74, h: 0.48,
      fill: { color: C.white },
      line: { color: m5.col, width: 1.5 },
      shadow: makeCardShadow(),
      rectRadius: 0.08,
    });
    s.addShape("ellipse", {
      x: 3.70, y: my + 0.10, w: 0.28, h: 0.28,
      fill: { color: m5.col }, line: { color: m5.col, width: 0 },
    });
    s.addText(`M${i + 1}`, {
      x: 3.70, y: my + 0.10, w: 0.28, h: 0.28,
      fontSize: 9, bold: true, color: C.white, align: "center",
      valign: "middle", fontFace: "Calibri", margin: 0,
    });
    s.addText(m5.m, {
      x: 4.06, y: my + 0.04, w: 2.22, h: 0.22,
      fontSize: 11, bold: true, color: C.black, fontFace: "Calibri", margin: 0,
    });
    s.addText(m5.desc, {
      x: 4.06, y: my + 0.24, w: 2.22, h: 0.20,
      fontSize: 8.5, color: C.muted, fontFace: "Calibri", margin: 0, wrap: true,
    });
  });

  // ── RIGHT: Report Types ──────────────────────────────
  const rightReports = [
    {
      title: "Today's Plan vs Actual",
      color: C.blue, bgColor: C.lightBlue,
      items: ["Job-wise plan vs produced", "Machine-wise targets", "Shift-wise gap analysis"],
    },
    {
      title: "Tonnage Report",
      color: "059669", bgColor: "ECFDF5",
      items: ["Daily / Weekly / Monthly", "Machine-wise kg produced", "Material consumption tracking"],
    },
    {
      title: "WIP Report",
      color: "D97706", bgColor: "FFFBEB",
      items: ["Colour Wise & Job Wise", "Daily / Weekly / Monthly", "In-process stock visibility"],
    },
  ];
  rightReports.forEach((rr, ri) => {
    const ry = 1.26 + ri * 1.30;
    s.addShape("roundRect", {
      x: 6.70, y: ry, w: 2.98, h: 1.20,
      fill: { color: rr.bgColor },
      line: { color: rr.color, width: 1.5 },
      shadow: makeCardShadow(),
      rectRadius: 0.12,
    });
    s.addText(rr.title, {
      x: 6.82, y: ry + 0.08, w: 2.74, h: 0.28,
      fontSize: 11.5, bold: true, color: rr.color, fontFace: "Calibri", margin: 0,
    });
    rr.items.forEach((item, ii) => {
      s.addShape("ellipse", {
        x: 6.84, y: ry + 0.42 + ii * 0.26, w: 0.12, h: 0.12,
        fill: { color: rr.color }, line: { color: rr.color, width: 0 },
      });
      s.addText(item, {
        x: 7.02, y: ry + 0.36 + ii * 0.26, w: 2.54, h: 0.24,
        fontSize: 9.5, color: C.black, fontFace: "Calibri", margin: 0,
      });
    });
  });

  addBrandFooter(s, true);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 16 — 3-LAYER APPROVAL SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.navy };

  s.addText("3-Layer Approval System", {
    x: 0.4, y: 0.22, w: 9.2, h: 0.52,
    fontSize: 26, bold: true, color: C.white, fontFace: "Calibri", margin: 0,
  });
  s.addText("Every entry verified. Every plan approved. Nothing enters production without sign-off.", {
    x: 0.4, y: 0.76, w: 9.2, h: 0.28,
    fontSize: 13, color: C.blue, fontFace: "Calibri", margin: 0,
  });

  const layers = [
    {
      num: "1",
      title: "Operator / Floor Level",
      role: "Shop Floor Worker",
      color: C.green,
      actions: ["Submit DPR entries", "Record production count", "Log rejections & downtime", "Scan barcodes"],
      what: "SUBMIT",
    },
    {
      num: "2",
      title: "Supervisor Level",
      role: "Production Supervisor",
      color: C.blue,
      actions: ["Verify DPR accuracy", "Cross-check machine data", "Approve shift summary", "Flag discrepancies"],
      what: "VERIFY",
    },
    {
      num: "3",
      title: "Manager / QC Level",
      role: "Plant Manager or QC Head",
      color: C.orange,
      actions: ["Final approval & lock", "Quality sign-off", "Escalation management", "Data goes to reports"],
      what: "APPROVE",
    },
  ];

  layers.forEach((L, li) => {
    const lx = 0.30 + li * 3.22;
    s.addShape("roundRect", {
      x: lx, y: 1.20, w: 3.04, h: 3.95,
      fill: { color: C.navyMid },
      line: { color: L.color, width: 2 },
      rectRadius: 0.16,
    });
    // Top badge
    s.addShape("roundRect", {
      x: lx, y: 1.20, w: 3.04, h: 0.72,
      fill: { color: L.color }, line: { color: L.color, width: 0 }, rectRadius: 0.16,
    });
    s.addShape("ellipse", {
      x: lx + 0.18, y: 1.26, w: 0.58, h: 0.58,
      fill: { color: C.navy }, line: { color: C.navy, width: 0 },
    });
    s.addText(L.num, {
      x: lx + 0.18, y: 1.26, w: 0.58, h: 0.58,
      fontSize: 22, bold: true, color: L.color, align: "center",
      valign: "middle", fontFace: "Calibri", margin: 0,
    });
    s.addText("Layer " + L.num, {
      x: lx + 0.84, y: 1.28, w: 2.05, h: 0.26,
      fontSize: 13, bold: true, color: C.white, fontFace: "Calibri", margin: 0,
    });
    s.addText(L.what, {
      x: lx + 0.84, y: 1.54, w: 2.05, h: 0.28,
      fontSize: 11, color: C.white, fontFace: "Calibri",
      margin: 0, transparency: 25, charSpacing: 2,
    });
    s.addText(L.title, {
      x: lx + 0.14, y: 2.04, w: 2.74, h: 0.32,
      fontSize: 12.5, bold: true, color: L.color, fontFace: "Calibri", margin: 0,
    });
    s.addText(L.role, {
      x: lx + 0.14, y: 2.36, w: 2.74, h: 0.24,
      fontSize: 10, color: C.white, fontFace: "Calibri",
      margin: 0, transparency: 40,
    });
    L.actions.forEach((a, ai) => {
      const ay = 2.72 + ai * 0.48;
      s.addShape("ellipse", {
        x: lx + 0.18, y: ay + 0.10, w: 0.20, h: 0.20,
        fill: { color: L.color }, line: { color: L.color, width: 0 },
      });
      s.addText(a, {
        x: lx + 0.46, y: ay, w: 2.46, h: 0.44,
        fontSize: 11, color: C.white, fontFace: "Calibri",
        valign: "middle", margin: 0, transparency: 15,
      });
    });
    // Arrow between layers
    if (li < 2) {
      s.addShape("line", {
        x: lx + 3.08, y: 2.68, w: 0.10, h: 0,
        line: { color: C.blue, width: 2.5 },
      });
    }
  });

  // Bottom highlight
  s.addShape("roundRect", {
    x: 0.30, y: 5.20, w: 9.40, h: 0.36,
    fill: { color: C.orange }, line: { color: C.orange, width: 0 }, rectRadius: 0.08,
  });
  s.addText("Data is LOCKED after Layer 3 — no backdating, no tampering. Full audit trail maintained.", {
    x: 0.30, y: 5.20, w: 9.40, h: 0.36,
    fontSize: 11.5, bold: true, color: C.white, align: "center",
    fontFace: "Calibri", valign: "middle", margin: 0,
  });

  addBrandFooter(s, false);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 17 — DPR COMPLIANCE SUMMARY (WORLD-CLASS UNIQUE FEATURE)
// ═══════════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  addSlideTitle(s, "DPR Compliance Summary — World-Class Unique Feature",
    "Never miss a production entry. 100% shop floor accountability.");

  // ── Left: Compliance heatmap ─────────────────────────
  s.addShape("roundRect", {
    x: 0.30, y: 1.26, w: 5.50, h: 3.88,
    fill: { color: "F8FAFF" },
    line: { color: "DBEAFE", width: 1 },
    shadow: makeCardShadow(),
    rectRadius: 0.14,
  });

  // Header
  s.addShape("roundRect", {
    x: 0.30, y: 1.26, w: 5.50, h: 0.42,
    fill: { color: C.navy }, line: { color: C.navy, width: 0 }, rectRadius: 0.14,
  });
  s.addText("LIVE COMPLIANCE HEATMAP  —  Today", {
    x: 0.30, y: 1.26, w: 5.50, h: 0.42,
    fontSize: 11, bold: true, color: C.white, align: "center",
    fontFace: "Calibri", valign: "middle", margin: 0, charSpacing: 0.8,
  });

  // Shift column headers
  const shiftCols = ["Machine", "Morning", "Evening", "Night", "Status"];
  const shiftColX = [0.40, 1.32, 2.30, 3.28, 4.26];
  const shiftColW = [0.85, 0.85, 0.85, 0.85, 0.90];
  shiftCols.forEach((sc, i) => {
    s.addText(sc, {
      x: shiftColX[i], y: 1.74, w: shiftColW[i], h: 0.26,
      fontSize: 9, bold: true, color: C.muted, align: "center",
      fontFace: "Calibri", margin: 0,
    });
  });

  // Compliance data
  const compData = [
    { mach: "INJ-01", m: "✅", e: "✅", n: "✅", status: "100%", statusCol: C.green  },
    { mach: "INJ-02", m: "✅", e: "⚠️", n: "✅", status: "67%",  statusCol: C.orange },
    { mach: "INJ-03", m: "✅", e: "✅", n: "❌", status: "67%",  statusCol: C.orange },
    { mach: "INJ-04", m: "❌", e: "✅", n: "✅", status: "67%",  statusCol: C.orange },
    { mach: "INJ-05", m: "✅", e: "✅", n: "✅", status: "100%", statusCol: C.green  },
    { mach: "ASM-A",  m: "✅", e: "❌", n: "❌", status: "33%",  statusCol: C.red    },
  ];
  compData.forEach((cd, ci) => {
    const ry = 2.04 + ci * 0.34;
    const rowBg = ci % 2 === 0 ? C.white : "F8FAFF";
    s.addShape("rect", {
      x: 0.36, y: ry, w: 5.36, h: 0.32,
      fill: { color: rowBg }, line: { color: "E5E7EB", width: 0.5 },
    });
    [cd.mach, cd.m, cd.e, cd.n, cd.status].forEach((val, vi) => {
      s.addText(val, {
        x: shiftColX[vi], y: ry + 0.04, w: shiftColW[vi], h: 0.24,
        fontSize: vi === 0 ? 10 : vi === 4 ? 11 : 14,
        bold: vi === 4,
        color: vi === 4 ? cd.statusCol : vi === 0 ? C.black : C.black,
        align: "center", fontFace: "Calibri", margin: 0,
      });
    });
  });

  // Overall compliance stat
  s.addShape("roundRect", {
    x: 0.36, y: 4.10, w: 5.36, h: 0.76,
    fill: { color: C.navy }, line: { color: C.navy, width: 0 }, rectRadius: 0.10,
  });
  s.addText([
    { text: "Overall Compliance Today:  ", options: { color: C.white, fontSize: 12 } },
    { text: "78%  ", options: { bold: true, color: C.orange, fontSize: 22 } },
    { text: " | Target: 100%", options: { color: C.white, fontSize: 12, transparency: 30 } },
  ], {
    x: 0.36, y: 4.10, w: 5.36, h: 0.76,
    align: "center", valign: "middle", fontFace: "Calibri", margin: 0,
  });

  // ── Right: Unique Features ────────────────────────────
  s.addText("What Makes This World-Class", {
    x: 6.05, y: 1.26, w: 3.58, h: 0.36,
    fontSize: 13, bold: true, color: C.navy, fontFace: "Calibri", margin: 0,
  });

  const uniqueFeatures = [
    { icon: "🔴", title: "Live Alert — Missed Entry", body: "Auto-alerts supervisor when DPR not submitted within 15 min of shift end" },
    { icon: "📊", title: "Operator Accountability Score", body: "Each operator has a DPR compliance % score — visible to management" },
    { icon: "🔒", title: "Tamper-Proof Timestamps", body: "Entries locked with server timestamp — no backdating possible" },
    { icon: "📱", title: "Mobile Push Notifications", body: "Supervisor gets instant notification when any entry is missed" },
    { icon: "📸", title: "Photo Proof Attachment", body: "Operators can attach machine photos to each DPR entry for proof" },
  ];
  uniqueFeatures.forEach((uf, i) => {
    const uy = 1.72 + i * 0.62;
    s.addShape("roundRect", {
      x: 6.05, y: uy, w: 3.60, h: 0.54,
      fill: { color: C.lightBlue }, line: { color: "BFDBFE", width: 1 },
      shadow: makeCardShadow(), rectRadius: 0.10,
    });
    s.addText(uf.icon, {
      x: 6.12, y: uy + 0.07, w: 0.38, h: 0.40,
      fontSize: 16, align: "center", valign: "middle", margin: 0,
    });
    s.addText(uf.title, {
      x: 6.54, y: uy + 0.04, w: 2.98, h: 0.22,
      fontSize: 10.5, bold: true, color: C.navy, fontFace: "Calibri", margin: 0,
    });
    s.addText(uf.body, {
      x: 6.54, y: uy + 0.25, w: 2.98, h: 0.26,
      fontSize: 8.5, color: C.muted, fontFace: "Calibri", wrap: true, margin: 0,
    });
  });

  addBrandFooter(s, true);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 18 — QUALITY + SHIFTING + PACKING DEPARTMENTS
// ═══════════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  addSlideTitle(s, "Quality · Shifting · Packing Departments",
    "Complete department coverage — from machine to dispatch");

  const depts = [
    {
      icon: "🔬", title: "Quality Department",
      color: "7C3AED", bg: "F5F3FF", borderCol: "DDD6FE",
      features: [
        "In-process QC checks per job",
        "Rejection reason classification (10+ categories)",
        "QC Supervisor real-time dashboard",
        "Machine-wise defect heatmap",
        "Customer complaint linkage",
        "Incoming material quality (GRN QC)",
        "Quality trend analysis & reports",
        "CAPA (Corrective Action) tracking",
      ],
    },
    {
      icon: "🔄", title: "Shifting Department",
      color: "0284C7", bg: "E0F2FE", borderCol: "BAE6FD",
      features: [
        "Inter-department material transfer",
        "Shifting request & approval flow",
        "Location-wise stock tracking",
        "WIP shifting between machines",
        "Shift-wise transfer summary",
        "Shortage alerts before shifts start",
        "Shifting logs with timestamps",
        "Export shifting reports",
      ],
    },
    {
      icon: "📦", title: "Packing Department",
      color: "059669", bg: "ECFDF5", borderCol: "A7F3D0",
      features: [
        "Job-wise packing entry",
        "Box / bag / label configuration",
        "Packing completion vs plan",
        "Customer label printing",
        "Dispatch-ready stock tracking",
        "Barcode scan on packing",
        "Packing settings per product",
        "Daily packing summary report",
      ],
    },
  ];

  depts.forEach((dept, di) => {
    const dx = 0.28 + di * 3.22;
    s.addShape("roundRect", {
      x: dx, y: 1.22, w: 3.06, h: 3.92,
      fill: { color: dept.bg }, line: { color: dept.borderCol, width: 1.5 },
      shadow: makeCardShadow(), rectRadius: 0.15,
    });
    // Header
    s.addShape("roundRect", {
      x: dx, y: 1.22, w: 3.06, h: 0.74,
      fill: { color: dept.color }, line: { color: dept.color, width: 0 }, rectRadius: 0.15,
    });
    s.addText(dept.icon, {
      x: dx + 0.14, y: 1.26, w: 0.52, h: 0.65,
      fontSize: 22, align: "center", valign: "middle", margin: 0,
    });
    s.addText(dept.title, {
      x: dx + 0.70, y: 1.30, w: 2.22, h: 0.62,
      fontSize: 12.5, bold: true, color: C.white, fontFace: "Calibri",
      valign: "middle", wrap: true, margin: 0,
    });
    // Feature list
    dept.features.forEach((f, fi) => {
      const fy = 2.06 + fi * 0.36;
      s.addShape("ellipse", {
        x: dx + 0.18, y: fy + 0.10, w: 0.14, h: 0.14,
        fill: { color: dept.color }, line: { color: dept.color, width: 0 },
      });
      s.addText(f, {
        x: dx + 0.40, y: fy, w: 2.52, h: 0.34,
        fontSize: 10.5, color: C.black, fontFace: "Calibri",
        valign: "middle", wrap: true, margin: 0,
      });
    });
  });

  // Bottom
  s.addShape("roundRect", {
    x: 0.28, y: 5.20, w: 9.44, h: 0.34,
    fill: { color: C.navy }, line: { color: C.navy, width: 0 }, rectRadius: 0.07,
  });
  s.addText("Every department connected. Every action tracked. Every decision data-driven.", {
    x: 0.28, y: 5.20, w: 9.44, h: 0.34,
    fontSize: 12, bold: true, color: C.orange, align: "center",
    fontFace: "Calibri", valign: "middle", margin: 0,
  });

  addBrandFooter(s, true);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 19 — HARDWARE & HOSTING REQUIREMENTS
// ═══════════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.white };
  addSlideTitle(s, "Hardware & Hosting Requirements",
    "What your factory needs to go live with FlowMES");

  // WiFi required badge (top-right)
  s.addShape("roundRect", {
    x: 7.08, y: 0.78, w: 2.62, h: 0.28,
    fill: { color: "FFF7ED" }, line: { color: "FED7AA", width: 1 }, rectRadius: 0.14,
  });
  s.addText("📶  WiFi / Access Point Required in Plant", {
    x: 7.08, y: 0.78, w: 2.62, h: 0.28,
    fontSize: 8, color: "C2410C", align: "center", valign: "middle",
    fontFace: "Calibri", bold: true, margin: 0,
  });

  // ── Three hardware cards ───────────────────────────────────────────────────
  const hwCards = [
    {
      icon: "🖥️",
      title: "Factory Local\nServer PC",
      color: C.orange,
      bg: "FFF7ED",
      border: "FED7AA",
      specs: [
        "Minimum 16 GB RAM",
        "Windows 10 / 11 Pro",
        "SSD Storage (250 GB+)",
        "1 per factory / plant",
        "Works offline, syncs to cloud",
      ],
      priceLabel: "₹ 30,000",
      priceNote: "per factory",
      scaleTag: "➕  1 per additional plant",
      scaleTagColor: C.orange,
    },
    {
      icon: "📱",
      title: "Supervisor\nMobile Phones",
      color: C.blue,
      bg: C.lightBlue,
      border: "BFDBFE",
      specs: [
        "Android 10+ recommended",
        "4G / WiFi enabled",
        "1 phone per 25 machines",
        "DPR, Dashboard & Alerts",
        "Barcode scanning support",
      ],
      priceLabel: "₹ 12,000",
      priceNote: "per phone",
      scaleTag: "➕  1 phone per 25 machines",
      scaleTagColor: C.blue,
    },
    {
      icon: "☁️",
      title: "Cloud VPS\nServer",
      color: "16A34A",
      bg: C.greenBg,
      border: "A7F3D0",
      specs: [
        "4 vCPU Cores",
        "16 GB RAM",
        "200 GB NVMe SSD",
        "16 TB Bandwidth / month",
        "Any cloud provider",
      ],
      priceLabel: "₹ 21,200",
      priceNote: "per year",
      scaleTag: "✅  Pay ONCE — covers all plants",
      scaleTagColor: "16A34A",
    },
  ];

  hwCards.forEach((card, ci) => {
    const cx = 0.28 + ci * 3.24;
    const cw = 3.06;
    const ch = 3.80;
    const cy = 1.20;

    // Card background
    s.addShape("roundRect", {
      x: cx, y: cy, w: cw, h: ch,
      fill: { color: card.bg }, line: { color: card.border, width: 1.5 },
      shadow: makeCardShadow(), rectRadius: 0.15,
    });

    // Colored header band
    s.addShape("roundRect", {
      x: cx, y: cy, w: cw, h: 0.72,
      fill: { color: card.color }, line: { color: card.color, width: 0 }, rectRadius: 0.15,
    });
    s.addText(card.icon, {
      x: cx + 0.10, y: cy + 0.04, w: 0.62, h: 0.64,
      fontSize: 26, align: "center", valign: "middle", margin: 0,
    });
    s.addText(card.title, {
      x: cx + 0.76, y: cy + 0.06, w: 2.16, h: 0.62,
      fontSize: 12.5, bold: true, color: C.white, fontFace: "Calibri",
      valign: "middle", wrap: true, margin: 0,
    });

    // Specs list
    card.specs.forEach((sp, si) => {
      const sy = cy + 0.84 + si * 0.36;
      s.addShape("ellipse", {
        x: cx + 0.20, y: sy + 0.12, w: 0.12, h: 0.12,
        fill: { color: card.color }, line: { color: card.color, width: 0 },
      });
      s.addText(sp, {
        x: cx + 0.40, y: sy, w: cw - 0.54, h: 0.34,
        fontSize: 10.5, color: C.black, fontFace: "Calibri",
        valign: "middle", wrap: true, margin: 0,
      });
    });

    // Price badge
    s.addShape("roundRect", {
      x: cx + 0.16, y: cy + 2.78, w: cw - 0.32, h: 0.52,
      fill: { color: card.color }, line: { color: card.color, width: 0 }, rectRadius: 0.10,
    });
    s.addText([
      { text: card.priceLabel, options: { fontSize: 17, bold: true, color: C.white } },
      { text: "  " + card.priceNote, options: { fontSize: 9.5, color: C.white, transparency: 15 } },
    ], {
      x: cx + 0.16, y: cy + 2.78, w: cw - 0.32, h: 0.52,
      align: "center", valign: "middle", fontFace: "Calibri", margin: 0,
    });

    // Scaling tag (inside card, below price badge)
    s.addText(card.scaleTag, {
      x: cx + 0.10, y: cy + 3.42, w: cw - 0.20, h: 0.26,
      fontSize: 9.5, color: card.scaleTagColor, align: "center",
      fontFace: "Calibri", bold: true, margin: 0,
    });
  });

  // ── Bottom navy summary banner ─────────────────────────────────────────────
  s.addShape("roundRect", {
    x: 0.28, y: 5.20, w: 9.44, h: 0.34,
    fill: { color: C.navy }, line: { color: C.navy, width: 0 }, rectRadius: 0.07,
  });
  s.addText("One cloud server covers all plants  ·  Add Local Server + Phones per new factory  ·  Simple. Scalable.", {
    x: 0.28, y: 5.20, w: 9.44, h: 0.34,
    fontSize: 11, bold: true, color: C.orange, align: "center",
    fontFace: "Calibri", valign: "middle", margin: 0,
  });

  addBrandFooter(s, true);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 20 — MACHINE GRID (LIVE FACTORY STATUS)
// ═══════════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: "F1F5F9" }; // matches app background colour
  addSlideTitle(s, "Machine Grid", "Live Factory Status — Building E · Building F");

  // ── Status styles ────────────────────────────────────────────────────────────
  const ST = {
    running: { border: C.green,   bg: "F0FDF4", pillBg: "DCFCE7", pillTxt: "15803D", label: "Running"  },
    stopped: { border: C.red,     bg: "FEF2F2", pillBg: "FEE2E2", pillTxt: "B91C1C", label: "Stopped"  },
    noPlan:  { border: "CBD5E1",  bg: C.white,  pillBg: "F1F5F9", pillTxt: "64748B", label: "No Plan"  },
  };

  const CW = 1.10, CH = 0.76, GAP = 0.08, SX = 0.27;

  // ── Section header helper ────────────────────────────────────────────────────
  function section(label, col, y) {
    s.addShape("roundRect", {
      x: SX, y, w: 9.46, h: 0.26,
      fill: { color: "E2E8F0" }, line: { color: "CBD5E1", width: 0.5 }, rectRadius: 0.06,
    });
    s.addShape("rect", {
      x: SX, y, w: 0.06, h: 0.26,
      fill: { color: col }, line: { color: col, width: 0 },
    });
    s.addText(label, {
      x: SX + 0.14, y, w: 9.20, h: 0.26,
      fontSize: 9.5, bold: true, color: C.black, fontFace: "Calibri",
      valign: "middle", margin: 0,
    });
  }

  // ── Machine card helper ───────────────────────────────────────────────────────
  function card(name, status, x, y) {
    const st = ST[status];
    s.addShape("roundRect", {
      x, y, w: CW, h: CH,
      fill: { color: st.bg }, line: { color: st.border, width: 1.5 }, rectRadius: 0.08,
      shadow: makeCardShadow(),
    });
    s.addText(name, {
      x: x + 0.04, y: y + 0.05, w: CW - 0.08, h: 0.30,
      fontSize: 7, bold: true, color: C.black, fontFace: "Calibri",
      align: "center", wrap: true, margin: 0,
    });
    s.addShape("roundRect", {
      x: x + 0.14, y: y + 0.42, w: CW - 0.28, h: 0.22,
      fill: { color: st.pillBg }, line: { color: st.border, width: 0 }, rectRadius: 0.11,
    });
    s.addText(st.label, {
      x: x + 0.14, y: y + 0.42, w: CW - 0.28, h: 0.22,
      fontSize: 8.5, bold: true, color: st.pillTxt, fontFace: "Calibri",
      align: "center", valign: "middle", margin: 0,
    });
  }

  // ── LINE E-L2  (8 machines, 1 row) ───────────────────────────────────────────
  section("LINE E – L2", C.blue, 1.22);

  const lineE = [
    ["E-L2-OM-150-1",    "running"],
    ["E-L2-PRIMA-220-2", "running"],
    ["E-L2-WIND-200-3",  "running"],
    ["E-L2-WIND-200-4",  "running"],
    ["E-L2-WIND-200-5",  "running"],
    ["E-L2-WIND-250-6",  "running"],
    ["E-L2-WIND-250-7",  "running"],
    ["E-L2-WIND-250-8",  "running"],
  ];
  lineE.forEach(([name, st], i) => card(name, st, SX + i * (CW + GAP), 1.52));

  // ── BUILDING F – LINE F-L1  (11 machines, 2 rows: 7 + 4) ─────────────────────
  section("BUILDING F  —  LINE F-L1", "059669", 2.40);

  const lineF = [
    ["F-L1-OMEGA-100-1",   "running"],
    ["F-L1-OMEGA-100-2",   "running"],
    ["F-L1-OMEGA-150-3",   "running"],
    ["F-L1-TOSHIBA-150-4", "noPlan" ],
    ["F-L1-ENGEL-120-5",   "running"],
    ["F-L1-ENGEL-120-6",   "running"],
    ["F-L1-ENGEL-120-7",   "running"],
    ["F-L1-ENGEL-120-8",   "running"],
    ["F-L1-ENGEL-120-9",   "stopped"],
    ["F-L1-ENGEL-120-10",  "stopped"],
    ["F-L1-ENGEL-120-11",  "running"],
  ];
  lineF.slice(0, 7).forEach(([name, st], i) => card(name, st, SX + i * (CW + GAP), 2.70));
  lineF.slice(7).forEach(([name, st],  i) => card(name, st, SX + i * (CW + GAP), 3.52));

  // ── Summary stats ─────────────────────────────────────────────────────────────
  const stats = [
    { val: "19", label: "Total Machines", col: C.navy  },
    { val: "16", label: "▶  Running",     col: C.green },
    { val: "2",  label: "■  Stopped",     col: C.red   },
    { val: "1",  label: "○  No Plan",     col: "64748B"},
  ];
  stats.forEach((st, i) => {
    const bx = SX + i * 2.38;
    s.addShape("roundRect", {
      x: bx, y: 4.42, w: 2.22, h: 0.58,
      fill: { color: C.white }, line: { color: st.col, width: 1.5 }, rectRadius: 0.10,
      shadow: makeCardShadow(),
    });
    s.addText(st.val, {
      x: bx, y: 4.45, w: 2.22, h: 0.28,
      fontSize: 20, bold: true, color: st.col, align: "center",
      fontFace: "Calibri", margin: 0,
    });
    s.addText(st.label, {
      x: bx, y: 4.73, w: 2.22, h: 0.20,
      fontSize: 8.5, color: C.muted, align: "center",
      fontFace: "Calibri", margin: 0,
    });
  });

  addBrandFooter(s, true);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 21 — MACHINE TIMELINE & PLANNING QUEUE
// ═══════════════════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: "F1F5F9" };
  addSlideTitle(s, "Machine Timeline & Planning Queue",
    "Real-time queue depth · Slot-wise job planning · Live load tracking — switch any plant instantly");

  // ── Factory / Plant switcher tabs ─────────────────────────────────────────
  const plants = ["Building A", "Building B – Line L1  ✓", "Building C", "Building F"];
  plants.forEach((p, i) => {
    const active = i === 1;
    s.addShape("roundRect", {
      x: 0.18 + i * 2.28, y: 1.22, w: 2.18, h: 0.24,
      fill: { color: active ? C.blue : "E2E8F0" },
      line: { color: active ? C.blue : "CBD5E1", width: active ? 0 : 0.75 }, rectRadius: 0.12,
    });
    s.addText(p, {
      x: 0.18 + i * 2.28, y: 1.22, w: 2.18, h: 0.24,
      fontSize: 8.5, bold: active, color: active ? C.white : C.muted,
      align: "center", valign: "middle", fontFace: "Calibri", margin: 0,
    });
  });

  // ── Column headers ─────────────────────────────────────────────────────────
  const HDR = [
    { label: "MACHINE",            bg: C.navy,    x: 0.18, w: 1.58 },
    { label: "▶ CURRENT / ACTIVE", bg: "16A34A",  x: 1.80, w: 1.52 },
    { label: "SLOT 2  —  NEXT",    bg: C.blue,    x: 3.36, w: 1.52 },
    { label: "SLOT 3",             bg: "3B82F6",  x: 4.92, w: 1.52 },
    { label: "SLOT 4",             bg: "64748B",  x: 6.48, w: 1.52 },
    { label: "MACHINE LOAD",       bg: C.navy,    x: 8.04, w: 1.78 },
  ];
  HDR.forEach(h => {
    s.addShape("roundRect", { x: h.x, y: 1.50, w: h.w, h: 0.24, fill: { color: h.bg }, line: { color: h.bg, width: 0 }, rectRadius: 0.05 });
    s.addText(h.label, { x: h.x, y: 1.50, w: h.w, h: 0.24, fontSize: 7, bold: true, color: C.white, align: "center", valign: "middle", fontFace: "Calibri", margin: 0 });
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  const STAT = {
    run:   { brd: C.green,  bg: "F0FDF4", badge: C.green,  lbl: "RUN",  btxt: C.white },
    plan:  { brd: C.blue,   bg: "EFF6FF", badge: C.blue,   lbl: "PLAN", btxt: C.white },
    stop:  { brd: C.red,    bg: "FEF2F2", badge: C.red,    lbl: "STOP", btxt: C.white },
    mc:    { brd: "7C3AED", bg: "F5F3FF", badge: "7C3AED", lbl: "MC",   btxt: C.white },
    empty: { brd: "E2E8F0", bg: "F8FAFC", badge: "CBD5E1", lbl: "—",    btxt: "94A3B8" },
  };
  const PRIO = { P1: C.red, P2: C.orange, P3: C.blue, P4: C.muted };
  const CW = 1.52, CH = 0.74;

  function jobCard(x, y, type, prio, product, cust, qty, timeInfo, pct) {
    const sc = STAT[type] || STAT.empty;
    s.addShape("roundRect", { x, y, w: CW, h: CH, fill: { color: sc.bg }, line: { color: sc.brd, width: 1.5 }, rectRadius: 0.07, shadow: makeCardShadow() });
    if (type === "empty") {
      s.addText("Empty Slot", { x, y: y + 0.26, w: CW, h: 0.22, fontSize: 8, color: "CBD5E1", align: "center", valign: "middle", fontFace: "Calibri", margin: 0 });
      return;
    }
    // Status badge
    s.addShape("roundRect", { x: x + CW - 0.38, y: y + 0.04, w: 0.34, h: 0.16, fill: { color: sc.badge }, line: { color: sc.badge, width: 0 }, rectRadius: 0.08 });
    s.addText(sc.lbl, { x: x + CW - 0.38, y: y + 0.04, w: 0.34, h: 0.16, fontSize: 6, bold: true, color: sc.btxt, align: "center", valign: "middle", fontFace: "Calibri", margin: 0 });
    // Priority pill
    if (prio && PRIO[prio]) {
      s.addShape("ellipse", { x: x + 0.04, y: y + 0.04, w: 0.20, h: 0.16, fill: { color: PRIO[prio] }, line: { color: PRIO[prio], width: 0 } });
      s.addText(prio, { x: x + 0.04, y: y + 0.04, w: 0.20, h: 0.16, fontSize: 6, bold: true, color: C.white, align: "center", valign: "middle", fontFace: "Calibri", margin: 0 });
    }
    // Text content
    s.addText(product, { x: x + 0.04, y: y + 0.22, w: CW - 0.08, h: 0.17, fontSize: 7.5, bold: true, color: C.black, fontFace: "Calibri", wrap: true, margin: 0 });
    s.addText(cust,    { x: x + 0.04, y: y + 0.39, w: CW - 0.08, h: 0.13, fontSize: 6.5, color: C.muted, fontFace: "Calibri", margin: 0 });
    s.addText(`${qty}  ·  ${timeInfo}`, { x: x + 0.04, y: y + 0.52, w: CW - 0.08, h: 0.12, fontSize: 6.5, color: C.black, fontFace: "Calibri", margin: 0 });
    // Progress bar
    if (pct !== null && pct !== undefined && type !== "plan" && type !== "mc") {
      const bw = CW - 0.10;
      s.addShape("roundRect", { x: x + 0.05, y: y + CH - 0.10, w: bw, h: 0.06, fill: { color: "E2E8F0" }, line: { color: "E2E8F0", width: 0 }, rectRadius: 0.03 });
      if (pct > 0) s.addShape("roundRect", { x: x + 0.05, y: y + CH - 0.10, w: bw * pct / 100, h: 0.06, fill: { color: sc.brd }, line: { color: sc.brd, width: 0 }, rectRadius: 0.03 });
    }
  }

  function machineCell(x, y, code, type, loadH, jobCt) {
    const dotC = type === "run" ? C.green : type === "stop" ? C.red : "7C3AED";
    s.addShape("roundRect", { x, y, w: 1.58, h: CH, fill: { color: C.white }, line: { color: "CBD5E1", width: 1 }, rectRadius: 0.07, shadow: makeCardShadow() });
    s.addShape("ellipse", { x: x + 0.10, y: y + 0.09, w: 0.14, h: 0.14, fill: { color: dotC }, line: { color: dotC, width: 0 } });
    s.addText(code, { x: x + 0.08, y: y + 0.24, w: 1.42, h: 0.26, fontSize: 8, bold: true, color: C.black, fontFace: "Calibri", wrap: true, margin: 0 });
    s.addText(`${loadH}h load  ·  ${jobCt} jobs`, { x: x + 0.08, y: y + 0.54, w: 1.42, h: 0.16, fontSize: 6.5, color: C.muted, fontFace: "Calibri", margin: 0 });
  }

  function loadCell(x, y, hours, maxH, jobs) {
    const col = hours > 80 ? C.red : hours > 40 ? C.orange : hours > 0 ? C.green : "CBD5E1";
    s.addShape("roundRect", { x, y, w: 1.78, h: CH, fill: { color: C.white }, line: { color: col, width: 1.5 }, rectRadius: 0.07, shadow: makeCardShadow() });
    s.addText(`${hours}h`, { x: x + 0.06, y: y + 0.04, w: 0.78, h: 0.30, fontSize: 20, bold: true, color: col, fontFace: "Calibri", valign: "middle", margin: 0 });
    s.addText(`${jobs} jobs`, { x: x + 0.86, y: y + 0.06, w: 0.84, h: 0.18, fontSize: 8.5, color: C.muted, fontFace: "Calibri", valign: "middle", margin: 0 });
    // Bar bg
    s.addShape("roundRect", { x: x + 0.06, y: y + 0.42, w: 1.68, h: 0.12, fill: { color: "E2E8F0" }, line: { color: "E2E8F0", width: 0 }, rectRadius: 0.06 });
    if (hours > 0) {
      const fw = 1.68 * Math.min(hours / maxH, 1);
      s.addShape("roundRect", { x: x + 0.06, y: y + 0.42, w: fw, h: 0.12, fill: { color: col }, line: { color: col, width: 0 }, rectRadius: 0.06 });
    }
    s.addText(`Max ${maxH}h capacity`, { x: x + 0.06, y: y + 0.57, w: 1.68, h: 0.13, fontSize: 6.5, color: C.muted, fontFace: "Calibri", margin: 0 });
  }

  // ── Row data (fictional — privacy safe) ──────────────────────────────────
  const ROWS = [
    {
      mach: { code: "INJ-HYD-350-1\n350T Hydraulic", type: "run",  load: 58, jobs: 4 },
      slots: [
        { t: "run",   p: "P1", prod: "Storage Bin 20L",   cust: "Metro Retail",    qty: "5,200 pcs", tm: "8h left",  pct: 72 },
        { t: "plan",  p: "P2", prod: "Bucket Lid 5L",     cust: "FreshMart Ltd.",  qty: "2,400 pcs", tm: "14h est",  pct: null },
        { t: "plan",  p: "P1", prod: "Container XL 40L",  cust: "ValuePlus Chain", qty: "1,800 pcs", tm: "20h est",  pct: null },
        { t: "plan",  p: "P3", prod: "Pail 10L Handle",   cust: "StarMart Co.",    qty: "3,600 pcs", tm: "16h est",  pct: null },
      ],
      loadH: 58, maxH: 120,
    },
    {
      mach: { code: "INJ-HYD-350-2\n350T Hydraulic", type: "run",  load: 44, jobs: 3 },
      slots: [
        { t: "run",   p: "P1", prod: "Bucket 10L Blue",  cust: "FreshMart Ltd.",  qty: "6,000 pcs", tm: "12h left", pct: 45 },
        { t: "plan",  p: "P2", prod: "Wastebin 15L",     cust: "City Stores",     qty: "4,200 pcs", tm: "18h est",  pct: null },
        { t: "plan",  p: "P3", prod: "Basin Deep 8L",    cust: "Global Homes",    qty: "2,800 pcs", tm: "14h est",  pct: null },
        { t: "empty", p: null, prod: "", cust: "", qty: "", tm: "", pct: null },
      ],
      loadH: 44, maxH: 120,
    },
    {
      mach: { code: "INJ-WIND-200-3\n200T Wind Power", type: "mc",   load: 42, jobs: 2 },
      slots: [
        { t: "mc",    p: null, prod: "Mould Change",     cust: "Maintenance",     qty: "—",         tm: "2h left",  pct: null },
        { t: "plan",  p: "P1", prod: "Rack Body 35L",    cust: "HomePlus Mart",   qty: "2,000 pcs", tm: "24h est",  pct: null },
        { t: "plan",  p: "P2", prod: "Chair Seat Grey",  cust: "Global Homes",    qty: "1,500 pcs", tm: "18h est",  pct: null },
        { t: "empty", p: null, prod: "", cust: "", qty: "", tm: "", pct: null },
      ],
      loadH: 42, maxH: 120,
    },
    {
      mach: { code: "INJ-ENG-120-4\n120T Engel",       type: "stop", load: 0,  jobs: 0 },
      slots: [
        { t: "stop",  p: "P1", prod: "Cap Body 500ml",  cust: "Metro Retail",    qty: "8,000 pcs", tm: "On Hold",  pct: 0 },
        { t: "empty", p: null, prod: "", cust: "", qty: "", tm: "", pct: null },
        { t: "empty", p: null, prod: "", cust: "", qty: "", tm: "", pct: null },
        { t: "empty", p: null, prod: "", cust: "", qty: "", tm: "", pct: null },
      ],
      loadH: 0, maxH: 120,
    },
  ];

  ROWS.forEach((row, ri) => {
    const ry = 1.78 + ri * (CH + 0.04);
    machineCell(0.18, ry, row.mach.code, row.mach.type, row.mach.load, row.mach.jobs);
    row.slots.forEach((sl, si) => {
      jobCard(1.80 + si * (CW + 0.04), ry, sl.t, sl.p, sl.prod, sl.cust, sl.qty, sl.tm, sl.pct);
    });
    loadCell(8.04, ry, row.loadH, row.maxH, row.mach.jobs);
  });

  // ── Bottom: legend + importance callout ────────────────────────────────────
  // Legend
  [
    { c: C.green,   l: "● Running"      },
    { c: C.blue,    l: "■ Planned"      },
    { c: C.red,     l: "✕ Stopped"      },
    { c: "7C3AED",  l: "◆ Mould Change" },
    { c: "CBD5E1",  l: "○ Empty Slot"   },
  ].forEach((leg, i) => {
    s.addText(leg.l, { x: 0.18 + i * 1.52, y: 5.06, w: 1.46, h: 0.18, fontSize: 7.5, bold: true, color: leg.c, fontFace: "Calibri", valign: "middle", margin: 0 });
  });

  // Importance callout (right side)
  s.addShape("roundRect", {
    x: 7.70, y: 5.00, w: 2.12, h: 0.28,
    fill: { color: C.navy }, line: { color: C.navy, width: 0 }, rectRadius: 0.07,
  });
  s.addText("🏭  Switch Plant → Instant Full Visibility", {
    x: 7.70, y: 5.00, w: 2.12, h: 0.28,
    fontSize: 7.5, bold: true, color: C.orange, align: "center", valign: "middle",
    fontFace: "Calibri", margin: 0,
  });

  addBrandFooter(s, true);
}

// ─── WRITE FILE ───────────────────────────────────────────────────────────────
const outputPath = "D:/jms_enterprise/SAAS_LAUNCH/FlowMES_CEO_Presentation.pptx";
pres.writeFile({ fileName: outputPath })
  .then(() => console.log("SUCCESS: " + outputPath))
  .catch(e => { console.error("ERROR:", e); process.exit(1); });
