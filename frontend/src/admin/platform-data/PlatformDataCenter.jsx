import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  BookOpen,
  CheckCircle2,
  Database,
  Loader2,
  Network,
  Play,
  Search,
  ShieldCheck,
} from "lucide-react";
import { graphLifecycleApi } from "../../api/graphLifecycleClient";
import { manualKnowledgeApi } from "../../api/manualKnowledgeClient";
import { platformOperationsApi } from "../../api/platformOperationsClient";
import { loadPlatformSession } from "../../api/platformTransport";
import { workOrderApi } from "../../api/workOrderClient";
import "./platform-data-center.css";

export default function PlatformDataCenter() {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [query, setQuery] = useState("风扇接线顺序");
  const [searchResult, setSearchResult] = useState(null);
  const session = useMemo(loadPlatformSession, []);

  async function load() {
    if (!session) return;
    setError("");
    const results = await Promise.allSettled([
      manualKnowledgeApi.list({ pageSize: 20 }),
      graphLifecycleApi.current(),
      workOrderApi.list({ pageSize: 20 }),
      platformOperationsApi.ingestionJobs(),
      platformOperationsApi.integrityRuns(),
    ]);
    const failed = results.find((item) => item.status === "rejected");
    if (failed) setError(failed.reason.message);
    setSnapshot({
      manuals: results[0].status === "fulfilled" ? results[0].value : { items: [], total: 0 },
      graph: results[1].status === "fulfilled" ? results[1].value : null,
      workOrders: results[2].status === "fulfilled" ? results[2].value : { items: [], total: 0 },
      ingestion: results[3].status === "fulfilled" ? results[3].value.items : [],
      integrity: results[4].status === "fulfilled" ? results[4].value.items : [],
    });
  }

  useEffect(() => { load(); }, []);

  async function action(name, callback) {
    setBusy(name);
    setError("");
    try {
      await callback();
      await load();
    } catch (nextError) {
      setError(`${nextError.message}${nextError.requestId ? ` · ${nextError.requestId}` : ""}`);
    } finally {
      setBusy("");
    }
  }

  if (!session) {
    return <main className="platform-data-center empty"><ShieldCheck size={30}/><h1>平台数据中心</h1><p>当前为录制兼容会话。使用平台账号登录后，可查看真实手册索引、图谱版本、工单和数据巡检结果。</p></main>;
  }
  if (!snapshot) {
    return <main className="platform-data-center empty"><Loader2 className="spin"/><p>正在读取平台权威数据…</p></main>;
  }
  return (
    <main className="platform-data-center">
      <header><div><span>PLATFORM DATA</span><h1>平台数据与知识工程</h1><p>以下信息直接来自身份保护的 SQLite 业务接口。</p></div><button onClick={load}>刷新数据</button></header>
      {error && <div className="platform-data-error">{error}</div>}
      <section className="platform-data-metrics">
        <Metric icon={BookOpen} label="已索引手册" value={snapshot.manuals.total}/>
        <Metric icon={Network} label="图谱节点" value={snapshot.graph?.nodes?.length || 0}/>
        <Metric icon={Database} label="检修工单" value={snapshot.workOrders.total}/>
        <Metric icon={Archive} label="入库任务" value={snapshot.ingestion.length}/>
      </section>
      <div className="platform-data-grid">
        <section><h2><BookOpen size={17}/>资料批量入库</h2><p>扫描受控的 Info 目录，任务由持久 worker 逐份处理。</p><button disabled={busy} onClick={() => action("ingestion", () => platformOperationsApi.createIngestionJob("Info"))}>{busy === "ingestion" ? <Loader2 className="spin"/> : <Play/>}创建入库任务</button><List items={snapshot.ingestion.slice(0, 4)} render={(item) => `${item.status} · ${item.counts.imported}/${item.counts.discovered}`}/></section>
        <section><h2><CheckCircle2 size={17}/>数据一致性</h2><p>核对数据库、FTS、图谱摘要和所有运行文件。</p><button disabled={busy} onClick={() => action("integrity", platformOperationsApi.runIntegrity)}>{busy === "integrity" ? <Loader2 className="spin"/> : <ShieldCheck/>}立即巡检</button><List items={snapshot.integrity.slice(0, 4)} render={(item) => `${item.status} · ${item.summary.findingCount || 0} 项`}/></section>
      </div>
      <section className="platform-search-panel">
        <h2><Search size={17}/>统一证据检索</h2>
        <div><input value={query} onChange={(event) => setQuery(event.target.value)}/><button disabled={!query.trim() || busy} onClick={() => action("search", async () => setSearchResult(await platformOperationsApi.unifiedSearch(query)))}>检索手册、案例与图谱</button></div>
        {searchResult && <div className="platform-search-results">{searchResult.items.map((item) => <article key={item.id}><span>{item.provider} · {item.score}</span><strong>{item.title}</strong><p>{item.excerpt}</p></article>)}</div>}
      </section>
    </main>
  );
}

function Metric({ icon: Icon, label, value }) {
  return <article><Icon/><span>{label}</span><strong>{value}</strong></article>;
}

function List({ items, render }) {
  return <div className="platform-data-list">{items.length ? items.map((item) => <div key={item.id}><code>{item.id}</code><span>{render(item)}</span></div>) : <p>暂无记录</p>}</div>;
}
