#!/usr/bin/env node
// 旧入口，保留给已安装的插件和旧的调用方式：原样转发到 pigeon.mjs。
// node meerkat-codex.mjs run|settings|doctor|open … 和 node pigeon.mjs … 完全一样。
import './pigeon.mjs';
