#!/usr/bin/env node
/** 手机插件 phone/guard.mjs 的拦截单测 + phone.mjs --dry-run 命令行检查（不连手机，不碰网络）。 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAdb, checkShell, checkKey, checkTapText, isPackageName, isNum } from '../packages/phone/phone/guard.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PHONE = path.join(ROOT, 'packages', 'phone', 'phone', 'phone.mjs');

let failed = 0;
const t = (name, fn) => {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
};
const blocked = (args) => assert.ok(checkAdb(args), `应该拦：${args.join(' ')}`);
const allowed = (args) => assert.equal(checkAdb(args), null, `不该拦：${args.join(' ')}`);

t('平时用的命令都放行', () => {
  allowed(['shell', 'input', 'tap', '540', '1600']);
  allowed(['shell', 'input', 'swipe', '540', '1800', '540', '600', '300']);
  allowed(['shell', 'input', 'keyevent', '224']);
  allowed(['shell', 'input', 'keyevent', '66']);
  allowed(['shell', 'wm', 'size']);
  allowed(['shell', 'wm', 'dismiss-keyguard']);
  allowed(['shell', 'dumpsys', 'power']);
  allowed(['shell', 'getprop', 'ro.product.model']);
  allowed(['shell', 'uiautomator', 'dump', '/sdcard/dsh_window.xml']);
  allowed(['exec-out', 'cat', '/sdcard/dsh_window.xml']);
  allowed(['exec-out', 'screencap', '-p']);
  allowed(['shell', 'am', 'start', '-n', 'com.tencent.mm/.ui.LauncherUI']);
  allowed(['shell', 'monkey', '-p', 'com.tencent.mm', '-c', 'android.intent.category.LAUNCHER', '1']);
  allowed(['shell', 'cmd', 'package', 'resolve-activity', '--brief', 'com.tencent.mm']);
  allowed(['shell', 'pm', 'list', 'packages', '-3']);
  allowed(['shell', 'am', 'broadcast', '-a', 'ADB_INPUT_B64', '--es', 'msg', Buffer.from('你好').toString('base64')]);
  allowed(['shell', 'ime', 'set', 'com.android.adbkeyboard/.AdbIME']);
  allowed(['devices', '-l']);
  allowed(['install', '-r', 'C:\\x\\tools\\ADBKeyboard.apk']);
});

t('打电话、发消息的 intent 拦下', () => {
  blocked(['shell', 'am', 'start', '-a', 'android.intent.action.CALL', '-d', 'tel:10086']);
  blocked(['shell', 'am', 'start', '-a', 'android.intent.action.DIAL']);
  blocked(['shell', 'am', 'start', '-a', 'android.intent.action.SENDTO', '-d', 'smsto:123']);
  blocked(['shell', 'am', 'start', '-a', 'android.intent.action.SEND', '--es', 'android.intent.extra.TEXT', 'hi']);
  blocked(['shell', 'am', 'start', '-d', 'tel:110']);
  blocked(['shell', 'am', 'start-activity', '-a', 'android.intent.action.call_privileged']);
  blocked(['shell', 'am', 'broadcast', '-a', 'android.intent.action.SEND_MULTIPLE']);
  blocked(['shell', 'service', 'call', 'phone', '2', 's16', '10086']);
  blocked(['shell', 'service', 'call', 'isms', '7']);
  blocked(['shell', 'input', 'keyevent', '5']);
  blocked(['shell', 'input', 'keyevent', 'KEYCODE_CALL']);
});

t('装卸应用、清数据、改设置、删文件拦下', () => {
  blocked(['shell', 'pm', 'uninstall', 'com.tencent.mm']);
  blocked(['shell', 'pm', 'clear', 'com.tencent.mm']);
  blocked(['shell', 'pm', 'disable-user', 'com.tencent.mm']);
  blocked(['shell', 'pm', 'grant', 'com.x', 'android.permission.CALL_PHONE']);
  blocked(['shell', 'cmd', 'package', 'uninstall', '-k', 'com.tencent.mm']);
  blocked(['uninstall', 'com.tencent.mm']);
  blocked(['install', '-r', 'evil.apk']);
  blocked(['reboot']);
  blocked(['shell', 'settings', 'put', 'global', 'airplane_mode_on', '1']);
  blocked(['shell', 'svc', 'wifi', 'disable']);
  blocked(['shell', 'wm', 'size', '720x1280']);
  blocked(['shell', 'rm', '-rf', '/sdcard/DCIM']);
  blocked(['shell', 'content', 'insert', '--uri', 'content://sms/sent']);
  blocked(['shell', 'reboot']);
});

t('参数里夹带别的命令拦下', () => {
  blocked(['shell', 'cmd', 'package', 'resolve-activity', '--brief', 'x;pm', 'uninstall', 'y']);
  blocked(['shell', 'input', 'tap', '1|reboot', '2']);
  blocked(['shell', 'ime', 'set', '$(reboot)']);
  blocked(['shell', 'input', 'tap', '1\nreboot', '2']);
  assert.ok(checkShell(['input', 'text', 'a;reboot']), '没转义的 ; 要拦');
});

t('input text 的内容转义过就放行，打出危险字样不算', () => {
  assert.equal(checkShell(['input', 'text', 'hello%sworld\\;\\(x\\)']), null);
  assert.equal(checkShell(['input', 'text', 'pm%suninstall']), null);
});

t('按键、find --tap、包名', () => {
  assert.ok(checkKey(5));
  assert.equal(checkKey(3), null);
  assert.equal(checkTapText('发送'), null, '发消息不在 find 里拦（主人同意了可以发）');
  assert.ok(checkTapText('转账'));
  assert.ok(checkTapText('确认支付'));
  assert.ok(checkTapText('拨打'));
  assert.ok(checkTapText('卸载'));
  assert.equal(checkTapText('微信'), null);
  assert.equal(checkTapText('发现'), null);
  assert.ok(isPackageName('com.tencent.mm'));
  assert.ok(!isPackageName('com.x;reboot'));
  assert.ok(!isPackageName('mm'));
  assert.ok(isNum('540') && !isNum('5;4'));
});

// 命令行：--dry-run 只打印 adb 命令，不连手机；被拦的退出码 3、说中文原因
const run = (...args) => spawnSync(process.execPath, [PHONE, ...args, '--dry-run'], { encoding: 'utf8', env: { ...process.env, ADB: 'adb-not-used' } });

t('命令行：按 CALL 键被拦，说清原因', () => {
  const r = run('key', 'CALL');
  assert.equal(r.status, 3);
  assert.match(r.stdout, /不执行.*不打电话/);
});
t('命令行：open 带奇怪包名不执行', () => {
  const r = run('open', 'x;pm uninstall com.tencent.mm');
  assert.notEqual(r.status, 0);
  assert.ok(!r.stdout.includes('adb-not-used'), '不该打印出 adb 命令');
});
t('命令行：swipe 参数不是数字不执行', () => {
  const r = run('swipe', '1', '2', '3', '4;reboot');
  assert.notEqual(r.status, 0);
});
t('命令行：正常 tap 照常', () => {
  const r = run('tap', '540', '1600');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /shell input tap 540 1600/);
});

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
