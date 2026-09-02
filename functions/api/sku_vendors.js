import { readKV } from '../lib/kv.js';

const EMPTY = { vendors: {}, counts: {}, updated_at: null };

export const onRequestGet = ({ env }) => readKV(env, 'ai:sku_vendors', EMPTY, 'sku_vendors');
