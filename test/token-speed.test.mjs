import test from 'node:test'
import assert from 'node:assert/strict'
import { reduceTokenSpeed, tokenSpeedSnapshot } from '../src/token-speed.mjs'
const event = (at, payload, type='event_msg') => ({timestamp:new Date(at).toISOString(),type,payload})
const usage = (at, total, last) => event(at,{type:'token_count',info:{total_token_usage:total,last_token_usage:last}})
const count = (input,output,cached=0,reasoning=0) => ({input_tokens:input,output_tokens:output,cached_input_tokens:cached,reasoning_output_tokens:reasoning})

test('response rates exclude tools, account for first output, and do not double count cached/reasoning tokens',()=>{
 let s=reduceTokenSpeed(undefined,event(1000,{type:'task_started'}))
 s=reduceTokenSpeed(s,event(5000,{type:'function_call_output'},'response_item'))
 s=reduceTokenSpeed(s,event(10000,{type:'item_completed',item:{type:'Reasoning'},started_at_ms:7000,completed_at_ms:10000}))
 s=reduceTokenSpeed(s,usage(15000,count(1000,100,800,40),count(1000,100,800,40)))
 const r=tokenSpeedSnapshot(s,15000)
 assert.equal(r.inputRate,100)
 assert.equal(r.outputRate,12.5)
 assert.equal(r.nonCachedInputRate,20)
 assert.equal(r.outputTokens,100)
 assert.equal(r.reasoningTokens,40)
 assert.equal(r.outputMethod,'output-start')
 assert.equal(r.status,'recent')
})

test('without a request boundary first cumulative sample is baseline, next sample uses bounded differences',()=>{
 let s=reduceTokenSpeed(undefined,usage(1000,count(10000,500)))
 assert.equal(tokenSpeedSnapshot(s,1000).outputRate,null)
 s=reduceTokenSpeed(s,usage(3000,count(11000,540)))
 const r=tokenSpeedSnapshot(s,3000)
 assert.equal(r.outputRate,20)
 assert.equal(r.inputRate,500)
 assert.equal(r.outputMethod,'interval')
})

test('duplicate events, a second event format, and reversed timestamps cannot create fake speed',()=>{
 let s=reduceTokenSpeed(undefined,event(1000,{type:'task_started'}))
 s=reduceTokenSpeed(s,usage(3000,count(100,20),count(100,20)))
 const sample=s.sample
 s=reduceTokenSpeed(s,usage(4000,count(100,20),count(100,20)))
 s=reduceTokenSpeed(s,event(5000,{thread_token_usage:count(100,20),usage:count(100,20)},'token_usage_record'))
 assert.equal(s.sample,sample)
 s=reduceTokenSpeed(s,usage(2000,count(200,40),count(100,20)))
 assert.equal(s.sample,sample)
})

test('new usage records report request counts and reset totals never become negative rates',()=>{
 let s=reduceTokenSpeed(undefined,event(1000,{type:'task_started'}))
 s=reduceTokenSpeed(s,event(3000,{thread_token_usage:count(1200,60),usage:count(1200,60)},'token_usage_record'))
 assert.equal(tokenSpeedSnapshot(s,3000).outputRate,30)
 s=reduceTokenSpeed(s,usage(5000,count(10,1),count(10,1)))
 assert.equal(tokenSpeedSnapshot(s,5000).outputRate,null)
})

test('stale, no-data, invalid intervals and closed Codex never masquerade as current rates',()=>{
 let s=reduceTokenSpeed(undefined,event(1000,{type:'task_started'}))
 s=reduceTokenSpeed(s,usage(1050,count(100,20),count(100,20)))
 assert.equal(tokenSpeedSnapshot(s,1050).outputRate,null)
 s=reduceTokenSpeed(s,usage(3000,count(200,40),count(100,20)))
 assert.equal(tokenSpeedSnapshot(s,50000).status,'stale')
 assert.equal(tokenSpeedSnapshot(s,50000).outputRate,null)
 assert.equal(tokenSpeedSnapshot(s,3000,{running:false}).status,'offline')
 assert.equal(tokenSpeedSnapshot(s,3000,{running:false}).outputRate,null)
})
