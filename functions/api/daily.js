import { readKV } from '../lib/kv.js';

const EMPTY = { title: 'Günlük Özet', highlights: [], risks: [], opportunities: [], updated_at: null };

export const onRequestGet = ({ env }) => readKV(env, 'ai:daily_summary', EMPTY, 'daily');
