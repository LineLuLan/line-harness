/* Intent: synthetic outputs of the three Windows tools the system sampler reads.
 * Status: shapes copied from Line's machine (tasklist, the CIM call) on 2026-11-13; the event 2004 XML follows
 *   the Resource-Exhaustion-Detector layout (no 2004 event was in the local log to copy, so the field names
 *   are from the documented shape, not a capture). Process names here are invented.
 * Next: replace the event fixture with a real capture once one exists. Blockers: none. */
'use strict';
// tasklist /fo csv /nh: one German-style ("1.234 K") and one English-style ("1,234 K") memory column.
const TASKLIST = [
  '"System Idle Process","0","Services","0","8 K"',
  '"chrome.exe","100","Console","1","300.000 K"',
  '"chrome.exe","101","Console","1","212,000 K"',
  '"node.exe","200","Console","1","1,048,576 K"',
  '"Code.exe","300","Console","1","409,600 K"',
  '"bad|name.exe","400","Console","1","999,999 K"',
  '"svchost.exe","500","Services","0","20,480 K"',
  'garbage line',
  ''
].join('\r\n');
// The CIM call: "<TotalVirtualMemorySize KB> <FreeVirtualMemory KB>" then the fixed drives.
const CIM = '40044916 19091924\r\nC: D:\r\n';
const event = (time, names) => `<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System>` +
  `<Provider Name='Microsoft-Windows-Resource-Exhaustion-Detector'/><EventID>2004</EventID>` +
  `<TimeCreated SystemTime='${time}'/><Channel>System</Channel></System><UserData><MemoryExhaustionInfo>` +
  `<SystemInfo><SystemCommitLimit>40000000000</SystemCommitLimit><SystemCommitCharge>39900000000</SystemCommitCharge></SystemInfo>` +
  `<ProcessInfo>${names.map((n, i) => `<Process_${i}><Name>${n}</Name><ID>${100 + i}</ID><CommitCharge>${9e9 - i}</CommitCharge></Process_${i}>`).join('')}</ProcessInfo>` +
  `</MemoryExhaustionInfo></UserData></Event>`;
const EVENTS = event('2026-11-13T09:15:02.1234567Z', ['node.exe', 'chrome.exe', 'Code.exe', 'node.exe', 'vmmem', 'x.exe']) +
  event('2026-11-12T22:01:00.000Z', ['msedge.exe']) +
  `<Event><System><EventID>1001</EventID><TimeCreated SystemTime='2026-11-12T22:02:00Z'/></System></Event>`;
module.exports = { TASKLIST, CIM, EVENTS, event };
