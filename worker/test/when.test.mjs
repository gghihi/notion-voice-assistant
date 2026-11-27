import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWhen, cnNum, twIso } from '../src/when.js';

// 基準時間：台灣 2026-11-28（週六）10:00
const NOW = Date.UTC(2026, 10, 28, 2, 0);
const tw = (ts) => twIso(ts).slice(0, 16);

test('中文數字', () => {
  assert.equal(cnNum('三'), 3); assert.equal(cnNum('十二'), 12); assert.equal(cnNum('二十五'), 25); assert.equal(cnNum('15'), 15); assert.equal(cnNum('半'), 30);
});
test('明天下午 3 點開會', () => {
  const r = parseWhen('明天下午3點開會', NOW);
  assert.equal(tw(r.at), '2026-11-29T15:00'); assert.equal(r.title, '開會');
});
test('明天下午三點半', () => assert.equal(tw(parseWhen('明天下午三點半開會', NOW).at), '2026-11-29T15:30'));
test('2 分鐘後提醒', () => {
  const r = parseWhen('2分鐘後提醒我喝水', NOW);
  assert.equal(r.at - NOW, 120000); assert.equal(r.title, '喝水');
});
test('兩小時後', () => assert.equal(parseWhen('兩小時後打電話', NOW).at - NOW, 7200000));
test('只說時間、已過 → 明天', () => assert.equal(tw(parseWhen('早上9點跑步', NOW).at), '2026-11-29T09:00'));
test('晚上 8:30', () => assert.equal(tw(parseWhen('今天晚上8:30看電影', NOW).at), '2026-11-28T20:30'));
test('下週一', () => assert.equal(tw(parseWhen('下週一上午10點交報告', NOW).at), '2026-12-07T10:00'));
test('週三', () => assert.equal(tw(parseWhen('星期三下午2點看牙醫', NOW).at), '2026-12-02T14:00'));
test('12月5日', () => assert.equal(tw(parseWhen('12月5日中午12點聚餐', NOW).at), '2026-12-05T12:00'));
test('看不懂時間就留空', () => assert.equal(parseWhen('買牛奶', NOW).at, null));
