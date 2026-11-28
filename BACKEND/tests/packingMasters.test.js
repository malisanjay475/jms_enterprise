'use strict';

const {
  analyseImportRows, itemKey, stationCode, pcsPerHour, canEditMasters
} = require('../src/modules/packing/registerPackingMasterRoutes');

const HEAD = ['ItemCode', 'ItemName', 'Store', 'CycleTime', 'Persons', 'PartyGroup'];

describe('packing masters import analysis', () => {
  test('reads the ERP StoreMachineOutPut layout', () => {
    const a = analyseImportRows([
      HEAD,
      ['0012', 'Super Bucket 116 Plain', 'Assembly Station - A', 6.68, 12, 'Reliance Retail'],
      ['0001', 'M.E. Camry Soap Case', '', '', '', 'ABRL Pvt. Label']
    ]);
    expect(a.missingHeaders).toEqual([]);
    expect(a.records).toHaveLength(2);
    expect(a.records[0]).toMatchObject({
      item_code: '0012', item_key: '12', station_name: 'Assembly Station - A',
      cycle_time_sec: 6.68, persons: 12, party_group: 'Reliance Retail', check_note: ''
    });
    expect(a.records[1]).toMatchObject({ station_name: '', cycle_time_sec: null, persons: null });
    expect(a.stations).toEqual(['Assembly Station - A']);
  });

  test('reports missing columns', () => {
    const a = analyseImportRows([['ItemCode', 'ItemName']]);
    expect(a.missingHeaders).toEqual(expect.arrayContaining(['station', 'cycle', 'persons', 'party']));
    expect(a.records).toHaveLength(0);
  });

  test('skips a stationed row without a usable cycle time or persons', () => {
    const a = analyseImportRows([
      HEAD,
      ['0015', 'Metro Mug', 'Assembly Station - D', '', 4, 'General Trade'],
      ['0016', 'Metro Mug 2', 'Assembly Station - D', 'abc', 4, 'General Trade'],
      ['0017', 'Metro Mug 3', 'Assembly Station - D', 10, 2.5, 'General Trade'],
      ['', 'No code', '', '', '', 'X']
    ]);
    expect(a.records).toHaveLength(0);
    expect(a.skipped.map(s => s.row)).toEqual([2, 3, 4, 5]);
  });

  test('marks odd values for checking but still imports them', () => {
    const a = analyseImportRows([
      HEAD,
      ['1', 'A', 'Assembly Station - A', 144, 8, 'P'],
      ['2', 'B', 'Assembly Station - A', 10, 0, 'P'],
      ['3', 'C', 'Assembly Station - A', 10, 116, 'P'],
      ['4', 'D', '', '', '', 'P'],
      ['004', 'D other name', '', '', '', 'Q']
    ]);
    const note = (code) => a.records.find(r => r.item_code === code).check_note;
    expect(note('1')).toMatch(/very slow/);
    expect(note('2')).toMatch(/Persons is 0/);
    expect(note('3')).toMatch(/too high/);
    expect(note('4')).toMatch(/more than one name/);
    expect(a.records).toHaveLength(5);
  });

  test('keeps one row per item + party + station; later duplicate wins with a warning', () => {
    const a = analyseImportRows([
      HEAD,
      ['0015', 'Metro Mug', 'Assembly Station - D', 11.04, 4, 'Reliance Retail'],
      ['0015', 'Metro Mug', 'Assembly Station - D', 10.65, 4, 'Reliance Retail'],
      ['0015', 'Metro Mug', 'Assembly Station - E1', 3, 8, 'Reliance Retail']
    ]);
    expect(a.records).toHaveLength(2);
    expect(a.records.find(r => r.station_name.endsWith('D')).cycle_time_sec).toBe(10.65);
    expect(a.warnings).toHaveLength(1);
  });

  test('drops the blank-station line when the same item + party has a station', () => {
    const a = analyseImportRows([
      HEAD,
      ['0027', 'Bucket 25', '', '', '', 'ABRL'],
      ['27', 'Bucket 25', 'Assembly Station - A', 20.69, 6, 'abrl']
    ]);
    expect(a.records).toHaveLength(1);
    expect(a.records[0].station_name).toBe('Assembly Station - A');
  });
});

describe('packing masters helpers', () => {
  test('item key drops leading zeros like JMS orders', () => {
    expect(itemKey('0121')).toBe('121');
    expect(itemKey(' 0 ')).toBe('0');
    expect(itemKey('vtp-lid')).toBe('VTP-LID');
  });
  test('station code and pcs per hour', () => {
    expect(stationCode('Assembly Station - D1 CleanMax')).toBe('D1 CleanMax');
    expect(stationCode('Table 3')).toBe('Table 3');
    expect(pcsPerHour(12)).toBe(300);
    expect(pcsPerHour(144)).toBe(25);
    expect(pcsPerHour(null)).toBeNull();
  });
  test('masters edit right', () => {
    expect(canEditMasters({ role: 'admin' })).toBe(true);
    expect(canEditMasters({ role: 'operator' })).toBe(false);
    expect(canEditMasters({ role: 'operator', permissions: { masters_edit: true } })).toBe(true);
    expect(canEditMasters({ role: 'planner', permissions: { masters: { edit: false } } })).toBe(false);
    expect(canEditMasters(null)).toBe(false);
  });
});
