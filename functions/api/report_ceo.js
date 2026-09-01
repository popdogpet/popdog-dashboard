import { readKV } from '../lib/kv.js';

const EMPTY = { text: '', updated_at: null };

export const onRequestGet = ({ env }) => readKV(env, 'ai:report_ceo', EMPTY, 'report_ceo');
