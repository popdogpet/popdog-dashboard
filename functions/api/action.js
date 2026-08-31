import { readKV } from '../lib/kv.js';

const EMPTY = { title: '', why: '', impact: '', urgency: '', updated_at: null };

export const onRequestGet = ({ env }) => readKV(env, 'ai:action', EMPTY, 'action');
