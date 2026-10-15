// Native owned-round capacity. Cards/tasks do not consume slots; an acquired
// round releases only after its owner completes. Fair fill is atomic in one JS owner.
export class QueueRefusal extends Error { readonly queueRefusal = true; }
export type QueueReady = { ready: boolean; reason?: string };
export type QueueRequest = {
  key: string; task: string; project: string; deadline: number; signal?: AbortSignal;
  limits(): { global: number; project: number };
  ready(): QueueReady; waiting(reason: string): void; admitted(): void;
};
type Pending = QueueRequest & { seq: number; resolve(release: () => void): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout>; abort(): void };
export function capacity(value: unknown, name: string): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 64) throw new Error(`${name} must be an explicit integer from 1 to 64`);
  return Number(value);
}
export class NativeQueue {
  private pending = new Map<string, Pending>();
  private owned = new Map<string, { task: string; project: string }>();
  private seq = 0;
  private scheduled = false;
  snapshot() { return { active: [...this.owned].map(([key, v]) => ({ key, ...v })), pending: [...this.pending.values()].sort((a,b) => a.seq-b.seq).map(p => ({ key:p.key, task:p.task, project:p.project, deadline:p.deadline })) }; }
  acquire(r: QueueRequest): Promise<() => void> {
    if (!r.key || !r.task || !r.project || !Number.isFinite(r.deadline)) return Promise.reject(new Error("invalid queue ownership/deadline"));
    if (r.deadline <= Date.now()) return Promise.reject(new QueueRefusal("readiness deadline expired; fresh preparation required"));
    if (this.pending.has(r.key) || this.owned.has(r.key)) return Promise.reject(new Error("round already has a queue owner"));
    return new Promise((resolve,reject) => {
      const abort = () => { const p=this.pending.get(r.key); if (p) { this.remove(p); reject(new QueueRefusal("queued round cancelled")); this.wake(); } };
      const timer=setTimeout(() => { const p=this.pending.get(r.key); if(p) { this.remove(p); reject(new QueueRefusal("readiness deadline expired; fresh preparation required")); this.wake(); } },Math.max(0,r.deadline-Date.now()));
      const p:Pending={...r,seq:++this.seq,resolve,reject,timer,abort}; this.pending.set(r.key,p);
      if(r.signal?.aborted) abort(); else { r.signal?.addEventListener("abort",abort,{once:true}); this.wake(); }
    });
  }
  private remove(p:Pending) { clearTimeout(p.timer); p.signal?.removeEventListener("abort",p.abort); this.pending.delete(p.key); }
  wake() { if(this.scheduled)return; this.scheduled=true; queueMicrotask(() => { this.scheduled=false; this.fill(); }); }
  private fill() {
    while(true) {
      const candidates=[...this.pending.values()].sort((a,b) => this.live(a.project)-this.live(b.project)||a.project.localeCompare(b.project)||a.seq-b.seq);
      let selected:Pending|null=null;
      for(const p of candidates) {
        try {
          if (p.deadline <= Date.now()) throw new QueueRefusal("readiness deadline expired; fresh preparation required");
          const lim=p.limits(), global=capacity(lim.global,"queue.global_capacity"), project=capacity(lim.project,"queue.project_capacity");
          const check=p.ready();
          if (p.deadline <= Date.now()) throw new QueueRefusal("readiness deadline expired; fresh preparation required");
          if(!check.ready) { p.waiting(check.reason??"readiness unavailable"); continue; }
          if(this.owned.size>=global || this.live(p.project)>=project) { p.waiting("live owned-round capacity is full"); continue; }
          selected=p; break;
        } catch(e:any) { this.remove(p); p.reject(new QueueRefusal(e?.message??String(e))); }
      }
      if(!selected)return;
      const p=selected; this.remove(p); this.owned.set(p.key,{task:p.task,project:p.project});
      try { p.admitted(); } catch(e:any) { this.owned.delete(p.key); p.reject(e); continue; }
      let released=false; p.resolve(() => { if(released)return; released=true; this.owned.delete(p.key); this.wake(); });
    }
  }
  private live(project:string) { return [...this.owned.values()].filter(v => v.project===project).length; }
}
// Conservative canonical pinned scopes: test paths do not hold other work.
const prefix=(s:string)=>s.split("/").filter((p,i,a)=>!a.slice(0,i+1).some(x=>/[*?\[]/.test(x))).join("/");
const glob=(s:string,p:string)=>new Bun.Glob(s).match(p);
export function scopesOverlap(a:string[],b:string[]):boolean {
  const paths=(xs:string[])=>xs.map(p=>p.trim().replace(/^\.\//,"").replace(/\/+$/,"")).filter(p=>!!p&&p!=="tests"&&!p.startsWith("tests/"));
  return paths(a).some(x=>paths(b).some(y=>{
    const gx=/[*?\[]/.test(x),gy=/[*?\[]/.test(y);
    if(!gx&&!gy)return x===y||x.startsWith(y.replace(/\/$/,"")+"/")||y.startsWith(x.replace(/\/$/,"")+"/");
    if(!gx||!gy){const pattern=gx?x:y,literal=gx?y:x;
      // Canonical literals name descendants with or without a trailing slash.
      // Without a pinned file-kind proof, compare static prefixes conservatively.
      const p=prefix(pattern);return glob(pattern,literal)||!p||p===literal||p.startsWith(literal+"/")||literal.startsWith(p+"/");
    }
    const px=prefix(x),py=prefix(y); return !px||!py||px===py||px.startsWith(py+"/")||py.startsWith(px+"/");
  }));
}
