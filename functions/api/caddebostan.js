import { readKV } from '../lib/kv.js';

const EMPTY = { date: null, grand_total: null, updated_at: null };

export const onRequestGet = ({ env }) => readKV(env, 'ai:caddebostan', EMPTY, 'caddebostan');
