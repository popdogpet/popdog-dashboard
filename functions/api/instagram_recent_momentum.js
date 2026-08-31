import { readKV } from '../lib/kv.js';

const EMPTY = {};

export const onRequestGet = ({ env }) => readKV(env, 'ai:instagram_recent_momentum', EMPTY, 'instagram_recent_momentum');
