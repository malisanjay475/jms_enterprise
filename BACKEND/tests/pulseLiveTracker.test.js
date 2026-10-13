'use strict';

const {
  buildTracker,
  currentShiftWindow,
  deriveState
} = require('../src/modules/pulse/registerPulseRoutes');

/* A shift window fixed in the middle of the day shift, so the tests do not
   depend on when they run. */
const WIN = {
  dprDate: '2026-10-13',
  shift: 'Day',
  slots: ['08-09', '09-10', '10-11', '11-12', '12-01', '01-02', '02-03', '03-04', '04-05', '05-06', '06-07', '07-08'],
  elapsed: 4
};

function rows(over) {
  return Object.assign({
    machines: [{ machine: 'L1-M01', line: 'B -L1', building: 'B' }],
    hourly: [],
    plans: [],
    moulds: [{ mould_number: 'MLD-1', mould_name: 'Crate Lid', pcs_per_hour: 100, manpower: 4 }],
    manpower: []
  }, over);
}

function hour(slot, good, extra) {
  return Object.assign({
    machine: 'L1-M01', hour_slot: slot, entry_type: 'MAIN', plan_id: 'PLN-1',
    mould_no: 'MLD-1', good_qty: good, reject_qty: 0, downtime_min: 0, remarks: null, id: 1
  }, extra || {});
}

describe('pulse live tracker', () => {
  it('scores output against the standard rate for the hours elapsed', () => {
    const [m] = buildTracker(rows({
      hourly: [hour('08-09', 100), hour('09-10', 100), hour('10-11', 90), hour('11-12', 90)]
    }), WIN);

    // 380 made, 400 expected after 4 hours at 100/hr
    expect(m.done).toBe(380);
    expect(m.cum[3]).toBe(95);
    expect(m.variance).toBe(-5);
    expect(m.std_rate).toBe(100);
    expect(m.shift_plan_qty).toBe(1200);
  });

  it('reads the rate from the last two slots, not the last one alone', () => {
    const [m] = buildTracker(rows({
      hourly: [hour('08-09', 100), hour('09-10', 100), hour('10-11', 120), hour('11-12', 80)]
    }), WIN);
    expect(m.rate).toBe(100);
  });

  it('adds up several entries recorded against the same hour slot', () => {
    const [m] = buildTracker(rows({
      hourly: [hour('08-09', 60), hour('08-09', 40, { id: 2 })]
    }), WIN);
    expect(m.done).toBe(100);
    expect(m.cum[0]).toBe(100);
  });

  it('describes a stopped machine by its stop reason, not by its rate', () => {
    const [m] = buildTracker(rows({
      hourly: [hour('08-09', 100), hour('09-10', 0, { entry_type: 'MouldChangeover', downtime_min: 45, id: 2 })]
    }), WIN);
    expect(m.state).toBe('CHANGEOVER');
    expect(m.stop_reason).toBe('Mould Changeover');
    expect(m.downtime_min).toBe(45);
  });

  it('flags a reject spike ahead of anything else about a running machine', () => {
    const [m] = buildTracker(rows({
      hourly: [hour('08-09', 90, { reject_qty: 10 }), hour('09-10', 90, { reject_qty: 10, id: 2 })]
    }), WIN);
    expect(m.reject_pct).toBe(10);
    expect(m.state).toBe('REJECT');
  });

  it('calls a machine STARVED when it is running an operator short', () => {
    const [m] = buildTracker(rows({
      hourly: [hour('08-09', 100), hour('09-10', 100, { id: 2 })],
      manpower: [{ machine_key: 'L1-M01', man_act: 3, mould_name: 'Crate Lid', plan_id: 'PLN-1' }]
    }), WIN);
    expect(m.act_manpower).toBe(3);
    expect(m.std_manpower).toBe(4);
    expect(m.state).toBe('STARVED');
  });

  it('separates a machine catching up from one slipping behind', () => {
    const behindButFast = deriveState({
      std_rate: 100, rate: 120, variance: -12, reject_pct: 0, done: 100,
      act_manpower: 4, std_manpower: 4, stop_state: null, job_card_no: 'JC-1'
    });
    const behindAndSlow = deriveState({
      std_rate: 100, rate: 70, variance: -12, reject_pct: 0, done: 100,
      act_manpower: 4, std_manpower: 4, stop_state: null, job_card_no: 'JC-1'
    });
    expect(behindButFast).toBe('CATCHING');
    expect(behindAndSlow).toBe('SLIPPING');
  });

  it('reports job-card progress alongside the shift figures', () => {
    const [m] = buildTracker(rows({
      hourly: [hour('08-09', 100)],
      plans: [{
        machine_key: 'L1-M01', plan_id: 'PLN-1', order_no: 'OR-1', status: 'RUNNING',
        job_card_no: 'JC-2451', mould_name: 'Crate Lid', mould_code: 'MLD-1',
        plan_qty: 20000, client_name: 'Acme', job_done: 12200
      }]
    }), WIN);
    expect(m.job_card_no).toBe('JC-2451');
    expect(m.job_pct).toBe(61);
    expect(m.job_qty).toBe(20000);
    // the shift basis is unaffected by the job card's larger numbers
    expect(m.done).toBe(100);
  });

  it('gives a machine with no standard rate no curve instead of a fake zero', () => {
    const [m] = buildTracker(rows({ moulds: [] }), WIN);
    expect(m.std_rate).toBe(0);
    expect(m.variance).toBe(null);
    expect(m.state).toBe('NOPLAN');
  });

  it('returns the building and line so the page can group by them', () => {
    const [m] = buildTracker(rows({ hourly: [hour('08-09', 100)] }), WIN);
    expect(m.building).toBe('B');
    expect(m.line).toBe('B -L1');
  });

  it('orders machines by building, then line, then machine number', () => {
    const out = buildTracker(rows({
      machines: [
        { machine: 'C-L1-M02', line: 'C -L1', building: 'C' },
        { machine: 'B-L2-M01', line: 'B -L2', building: 'B' },
        { machine: 'C-L1-M01', line: 'C -L1', building: 'C' },
        { machine: 'B-L1-M10', line: 'B -L1', building: 'B' },
        { machine: 'B-L1-M02', line: 'B -L1', building: 'B' }
      ]
    }), WIN);
    expect(out.map((m) => m.machine))
      .toEqual(['B-L1-M02', 'B-L1-M10', 'B-L2-M01', 'C-L1-M01', 'C-L1-M02']);
  });

  it('still lists a machine that produced but is missing from the machine master', () => {
    const out = buildTracker(rows({
      machines: [],
      hourly: [hour('08-09', 100)]
    }), WIN);
    expect(out.map((m) => m.machine)).toEqual(['L1-M01']);
  });

  it('keeps the night shift on the previous day\'s DPR date before 08:00', () => {
    const win = currentShiftWindow(new Date(2026, 9, 14, 2, 30));
    expect(win.shift).toBe('Night');
    expect(win.dprDate).toBe('2026-10-13');
    expect(win.slots[0]).toBe('20-21');
    expect(win.elapsed).toBe(7); // 20,21,22,23,00,01,02
  });

  it('starts the day shift at 08:00 on the same date', () => {
    const win = currentShiftWindow(new Date(2026, 9, 13, 8, 5));
    expect(win.shift).toBe('Day');
    expect(win.dprDate).toBe('2026-10-13');
    expect(win.elapsed).toBe(1);
  });
});
