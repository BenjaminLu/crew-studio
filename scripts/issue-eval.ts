// The issue evaluation set (docs/units/issue-eval.md): label a project's issues, then score the current triage rules and
// categories against those labels. Offline, deterministic and free: no model runs, nothing is read from or written to
// GitHub. Everything it writes goes under the data directory (data/issue-eval/<project>/), never into the repository.
//
//   bun scripts/issue-eval.ts mine <project>                 refresh the labels derived from what Studio records
//   bun scripts/issue-eval.ts label <project> [--sample 50] [--seed s] [--out file]
//                                                            write a template to label, prefilled with the current answers
//   bun scripts/issue-eval.ts import <project> <file>        import a labeled template (refused whole on any bad row)
//   bun scripts/issue-eval.ts score <project> [--repo path] [--out file] [--no-write]
//                                                            replay the stored reports through the current rules
//     --data <dir>   Studio's data directory (default: $CREW_DATA, else ./data of this checkout)
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Projects} from '../src/doors';
import {git} from '../src/git';
import {IssueTriageStore} from '../src/issue-triage-store';
import {IssueCategoriesStore} from '../src/issue-categories-store';
import {IssueEvalStore,commitReader,privatePathProblem} from '../src/issue-eval-store';
import {categoryAnswers,emptyGold,followMerged,goldHash,labelTemplate,mineDerived,parseLabels,replay,reportCategories,score,scoreKey,SCORE_SCHEMA} from '../src/domain/issue-eval';

const ROOT=resolve(import.meta.dir,'..'),argv=process.argv.slice(2);
const flag=(name:string)=>{const i=argv.indexOf(name);return i<0?undefined:argv[i+1];};
const has=(name:string)=>argv.includes(name);
const die=(m:string):never=>{console.error(m);process.exit(1);};
const positional=argv.filter((a,i)=>!a.startsWith('--')&&!(i>0&&['--data','--sample','--seed','--out','--repo'].includes(argv[i-1])));
const [cmd,project,file]=positional;
if(!cmd||!['mine','label','import','score'].includes(cmd)||!project)die('usage: bun scripts/issue-eval.ts mine|label|import|score <project> [file] [--data dir] (see the header of this script)');
const dataDir=resolve(flag('--data')??process.env.CREW_DATA??join(ROOT,'data'));
/** private data never enters the repository: the data directory, and any file this writes, is outside the checkout or
 *  ignored by git (the checkout's own data/ is) */
const ignored=(rel:string)=>git(ROOT,['check-ignore','-q','--',rel]).ok;
const guard=(p:string,what:string)=>{const why=privatePathProblem(ROOT,p,ignored);if(why)die(`${what}: ${why}`);return resolve(p);};
guard(join(dataDir,'issue-eval',project.replace(/[^\w.-]/g,'_'),'gold.json'),'--data');
const evals=new IssueEvalStore(dataDir);
try{evals.dir(project);}catch(e:any){die(`${String(project).slice(0,200)}: ${String(e?.message??e)}`);}
const triageRec=new IssueTriageStore(dataDir).get(project),catRec=new IssueCategoriesStore(dataDir).get(project);
if(!triageRec&&!catRec)die(`${project} has no issue triage and no categories in ${dataDir}`);
const now=new Date().toISOString();
const outside=(p:string)=>guard(p,'--out');
/** derived labels, refreshed from the records; the captain's are kept as they are */
const mined=()=>{const g=evals.gold(project)??emptyGold(project,now);return{...g,derived:mineDerived({triage:triageRec,categories:catRec,work:p=>evals.work(p),at:now}),updatedAt:now};};

if(cmd==='mine'){const g=mined();evals.writeGold(g);console.log(`${project}: ${Object.keys(g.derived).length} derived labels, ${Object.keys(g.captain).length} from the captain`);process.exit(0);}

if(cmd==='label'){
 const sample=Number(flag('--sample')??50);if(!Number.isSafeInteger(sample)||sample<1||sample>2000)die('--sample is 1 to 2000');
 // each investigator's own answer, from the stored reports (the code is not needed for the answers)
const reports=replay(evals.triageBatches(project,()=>()=>null).batches).preds;
 const t=labelTemplate({project,triage:triageRec,categories:catRec,gold:evals.gold(project),sample,seed:flag('--seed')??project,at:now,reports});
 const out=flag('--out')?outside(flag('--out')!):null;
 if(out)writeFileSync(out,JSON.stringify(t,null,1),{mode:0o600});
 console.log(`${t.rows.length} issues to label in ${new Set(t.rows.map(r=>r.stratum)).size} strata: ${out??evals.writeTemplate(project,t,now)}`);
 console.log(`Edit each row's gold, set "reviewed": true, then: bun scripts/issue-eval.ts import ${project} <file>`);process.exit(0);}

if(cmd==='import'){
 if(!file)die('name the labeled file');
 let raw:any;try{raw=JSON.parse(readFileSync(file,'utf8'));}catch(e:any){die(`${file} is not JSON: ${String(e?.message??e).slice(0,200)}`);}
 let r:ReturnType<typeof parseLabels>;try{r=parseLabels(raw,{project,triage:triageRec,categories:catRec,at:now});}catch(e:any){die(String(e?.message??e));}
 const g=mined();evals.writeGold({...g,captain:{...g.captain,...r!.labels}});
 console.log(`${Object.keys(r!.labels).length} labels imported from the captain; ${r!.skipped} rows not reviewed, skipped`);process.exit(0);}

// --- score ---
let repo=flag('--repo')??null;
if(!repo){try{repo=new Projects(dataDir).nativeSnapshot().records.find(p=>p.id===project)?.github?.localPath??null;}catch{repo=null;}}
const reader=commitReader(repo?resolve(repo):null),{batches,missing}=evals.triageBatches(project,reader);
const gold=has('--no-write')?mined():(()=>{const g=mined();evals.writeGold(g);return g;})();
const replayed=replay(batches),cats=categoryAnswers(catRec,catRec?reportCategories(catRec,evals.categoryReports(project)):new Map());
const result=score({gold,replayed,categories:cats,follow:followMerged(catRec)});
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const DOMAIN=['src/domain/issue-triage.ts','src/domain/issue-categories.ts','src/domain/issue-eval.ts','src/issue-eval-store.ts','scripts/issue-eval.ts'];
const commit=git(ROOT,['rev-parse','HEAD']).out||'unknown',dirty=!!git(ROOT,['status','--porcelain','--',...DOMAIN]).out,rules=sha(DOMAIN.map(f=>readFileSync(join(ROOT,f),'utf8')).join('\0'));
const reportSkills=[...batches.flatMap(b=>b.skills??[]),...evals.categoryReports(project).flatMap(r=>r.skill?[r.skill]:[])];
const current=Object.fromEntries(['issue-triager','issue-categorizer'].map(s=>{try{return[s,sha(readFileSync(join(ROOT,'workflows/skills',`${s}.md`),'utf8'))];}catch{return[s,null];}}));
const gh=goldHash(gold),{key,skills}=scoreKey({skills:reportSkills,commit,rules,dirty,gold:gh});
const out={schema:SCORE_SCHEMA,kind:'issue-eval-score',project,key,at:now,code:{commit,dirty,rules},goldHash:gh,
 skills:{reports:skills,recorded:[...new Set(reportSkills)].sort(),current},
 replay:{batches:batches.length,withoutReports:missing.length,unreadableCommits:reader.missing.size,repository:repo?'given':'none'},...result};
const where=has('--no-write')?null:evals.writeScore(project,key,out);
if(flag('--out'))writeFileSync(outside(flag('--out')!),JSON.stringify(out,null,1),{mode:0o600});
const pct=(v:number|null)=>v===null?'  -  ':`${(v*100).toFixed(1)}%`;
console.log(`issue-eval ${project}  key ${key}  (${batches.length} batches replayed, ${result.runs.skipped.length} skipped; ${result.gold.issues} gold issues: ${result.gold.captain} captain, ${result.gold.derived} derived)`);
if(!repo)console.log('warning: no repository (--repo, or the project\'s GitHub folder): every code check fails, so Studio packages nothing');
else if(reader.missing.size)console.log(`warning: ${reader.missing.size} report commit(s) are not in the repository: their code checks fail`);
for(const w of ['a','b','studio'] as const){const s=result.state[w],f=result.files[w],x=result.security[w];
 console.log(`${w.padEnd(6)} state acc ${pct(s.accuracy)} recall ${pct(s.recall)} (n=${s.gold})  files hit ${pct(f.hit)} P ${pct(f.precision)} R ${pct(f.recall)} (n=${f.gold})  security acc ${pct(x.accuracy)} yes P ${pct(x.classes.yes.precision)} R ${pct(x.classes.yes.recall)} (n=${x.gold})`);}
console.log(`category acc ${pct(result.category.accuracy)} recall ${pct(result.category.recall)} (n=${result.category.gold})  planned P ${pct(result.category.planned.precision)} R ${pct(result.category.planned.recall)}`);
console.log(`package pairs P ${pct(result.package.pairs.precision)} R ${pct(result.package.pairs.recall)}  exact ${pct(result.package.exact)} (n=${result.package.gold}; ${result.package.pairs.crossBatch} cross-batch pairs not scored)`);
for(const src of ['captain','derived'] as const){const m=result.bySource[src];
 console.log(`${src} gold only: studio state acc ${pct(m.state.studio.accuracy)} (n=${m.state.studio.gold})  category acc ${pct(m.category.accuracy)} (n=${m.category.gold})  package pairs P ${pct(m.package.pairs.precision)} R ${pct(m.package.pairs.recall)} (n=${m.package.gold})`);}
console.log(`routed to a person ${pct(result.human.share)} (${result.human.routed} of ${result.human.investigated} investigated)`);
if(where)console.log(`written: ${where}`);
