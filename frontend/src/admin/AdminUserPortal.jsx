import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  CircleOff,
  KeyRound,
  LogOut,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { presentationApi } from "./presentationApi";
import "./user-management.css";

const USER_STORAGE_KEY = "la-admin-users-v2";

const fallbackUsers = [
  { id: "ENG-001", account: "worker001", name: "李师傅", role: "engineer", site: "山东德州分输站", team: "站控运维一班", status: "active" },
  { id: "ENG-002", account: "wangong", name: "王志强", role: "engineer", site: "北区输气场站", team: "设备保障二班", status: "active" },
  { id: "ENG-003", account: "zhaoshifu", name: "赵建国", role: "engineer", site: "南区分输站", team: "自动化维护组", status: "active" },
  { id: "ENG-004", account: "guojianjun", name: "郭建军", role: "engineer", site: "德州作业区", team: "仪控保障组", status: "active" },
  { id: "ENG-005", account: "chenzhiqiang", name: "陈志强", role: "engineer", site: "山东德州分输站", team: "站控运维二班", status: "active" },
  { id: "EXP-001", account: "expert001", name: "王海峰", role: "expert", organization: "国家管网集团山东德州分输站 · 设备技术组", specialty: "工控机与站控系统", status: "active" },
  { id: "EXP-002", account: "zhouqiming", name: "周启明", role: "expert", organization: "山东区域技术支持中心 · 自动化组", specialty: "PLC、DCS 与控制网络", status: "active" },
  { id: "EXP-003", account: "sunjian", name: "孙健", role: "expert", organization: "德州作业区 · 仪控保障组", specialty: "电源系统、仪表回路与联锁保护", status: "active" },
];

const emptyUser = {
  id: "",
  account: "",
  name: "",
  role: "engineer",
  site: "山东德州分输站",
  team: "站控运维一班",
  organization: "国家管网集团山东德州分输站 · 设备技术组",
  specialty: "工控机与站控系统",
  status: "active",
};

function normalizeUsers(items) {
  const accountFallbacks = ["worker001", "wangong", "zhaoshifu", "guojianjun", "chenzhiqiang", "expert001", "zhouqiming", "sunjian"];
  return items
    .filter((item) => item?.role === "engineer" || item?.role === "expert")
    .map((item, index) => ({
      ...emptyUser,
      ...item,
      account: item.account || accountFallbacks[index] || `${item.role}${index + 1}`,
      name: item.role === "expert" && item.name === "专家账号" ? "王海峰" : item.name,
      organization: item.organization || (item.role === "expert" ? "国家管网集团山东德州分输站 · 设备技术组" : ""),
      specialty: item.specialty || (item.role === "expert" ? "工控机与站控系统" : ""),
    }));
}

function readStoredUsers() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(USER_STORAGE_KEY));
    return Array.isArray(stored) && stored.length ? normalizeUsers(stored) : null;
  } catch {
    return null;
  }
}

function roleLabel(role) {
  return role === "expert" ? "专家" : "工程师";
}

export default function AdminUserPortal({ onLogout }) {
  const [users, setUsers] = useState(() => readStoredUsers() || fallbackUsers);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(!readStoredUsers());

  useEffect(() => {
    if (readStoredUsers()) {
      setLoading(false);
      return undefined;
    }

    let active = true;
    presentationApi.users()
      .then((items) => {
        if (!active) return;
        const normalized = normalizeUsers(items);
        const nextUsers = normalized.length >= fallbackUsers.length
          ? normalized.map((item) => item.id === "EXP-001" ? { ...item, name: "王海峰" } : item)
          : fallbackUsers;
        setUsers(nextUsers);
        window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(nextUsers));
      })
      .catch(() => {
        if (!active) return;
        setUsers(fallbackUsers);
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  function persist(nextUsers) {
    setUsers(nextUsers);
    window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(nextUsers));
  }

  function showNotice(message) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2400);
  }

  function nextUserId(role) {
    const prefix = role === "expert" ? "EXP" : "ENG";
    const maxId = users
      .filter((item) => item.role === role)
      .reduce((max, item) => Math.max(max, Number(item.id.split("-")[1]) || 0), 0);
    return `${prefix}-${String(maxId + 1).padStart(3, "0")}`;
  }

  function saveUser(form) {
    const duplicate = users.some((item) => item.account.toLowerCase() === form.account.trim().toLowerCase() && item.id !== form.id);
    if (duplicate) return "登录账号已存在，请更换账号。";

    const normalized = {
      ...form,
      id: form.id || nextUserId(form.role),
      name: form.name.trim(),
      account: form.account.trim().toLowerCase(),
      site: form.site.trim(),
      team: form.team.trim(),
      organization: form.organization.trim(),
      specialty: form.specialty.trim(),
    };
    const exists = users.some((item) => item.id === normalized.id);
    persist(exists ? users.map((item) => item.id === normalized.id ? normalized : item) : [normalized, ...users]);
    setEditor(null);
    showNotice(exists ? `已更新 ${normalized.name} 的账号资料` : `已新增${roleLabel(normalized.role)} ${normalized.name}`);
    return "";
  }

  function toggleUser(user) {
    const nextStatus = user.status === "active" ? "disabled" : "active";
    persist(users.map((item) => item.id === user.id ? { ...item, status: nextStatus } : item));
    showNotice(`${user.name} 已${nextStatus === "active" ? "启用" : "停用"}`);
  }

  const stats = useMemo(() => ({
    engineer: users.filter((item) => item.role === "engineer").length,
    expert: users.filter((item) => item.role === "expert").length,
    active: users.filter((item) => item.status === "active").length,
    disabled: users.filter((item) => item.status !== "active").length,
  }), [users]);

  const visibleUsers = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return users.filter((user) => {
      if (filter !== "all" && user.role !== filter) return false;
      if (!keyword) return true;
      return [user.name, user.account, user.site, user.team, user.organization, user.specialty]
        .some((value) => String(value || "").toLowerCase().includes(keyword));
    });
  }, [filter, query, users]);

  return (
    <div className="user-admin-shell">
      <aside className="user-admin-sidebar">
        <header><i><Users size={20} /></i><div><span>ADMIN CONSOLE</span><strong>用户管理中心</strong></div></header>
        <small>管理菜单</small>
        <nav aria-label="管理员导航"><button className="active"><Users size={17} /><span>用户管理</span><ChevronRight size={14} /></button></nav>
        <section><div><UserRound size={16} /><span>当前账号<strong>系统管理员</strong><small>平台运维中心</small></span></div><button onClick={onLogout}><LogOut size={15} />退出登录</button></section>
      </aside>

      <main className="user-admin-main">
        {notice && <div className="user-admin-toast" role="status"><Check size={15} />{notice}</div>}
        <header className="user-admin-head">
          <div><span>ACCOUNT & ORGANIZATION</span><h1>用户与角色管理</h1><p>维护工程师和专家的演示账号、组织归属与启停状态。</p></div>
          <button className="user-admin-primary" onClick={() => setEditor({ ...emptyUser })}><Plus size={16} />新增用户</button>
        </header>

        <section className="user-admin-stats" aria-label="账号统计">
          <article><i><UserRound size={18} /></i><span>工程师</span><strong>{stats.engineer}</strong><small>现场检修账号</small></article>
          <article><i><ShieldCheck size={18} /></i><span>专家</span><strong>{stats.expert}</strong><small>审核与专业支持</small></article>
          <article className="active"><i><Check size={18} /></i><span>正常账号</span><strong>{stats.active}</strong><small>当前允许登录</small></article>
          <article className="disabled"><i><CircleOff size={18} /></i><span>停用账号</span><strong>{stats.disabled}</strong><small>暂停平台访问</small></article>
        </section>

        <section className="user-admin-panel">
          <header className="user-admin-toolbar">
            <div className="user-admin-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名、账号、场站或专业方向" /></div>
            <div className="user-admin-filters" aria-label="角色筛选">
              {[['all','全部'],['engineer','工程师'],['expert','专家']].map(([value, label]) => <button className={filter === value ? "active" : ""} onClick={() => setFilter(value)} key={value}>{label}<span>{value === "all" ? users.length : users.filter((item) => item.role === value).length}</span></button>)}
            </div>
          </header>

          <div className="user-admin-table-head"><span>人员</span><span>登录账号</span><span>角色与归属</span><span>状态</span><span>操作</span></div>
          <div className="user-admin-list">
            {loading && <div className="user-admin-empty">正在读取演示账号…</div>}
            {!loading && visibleUsers.map((user) => (
              <article className={user.status === "active" ? "" : "is-disabled"} key={user.id}>
                <div className="user-admin-person"><i>{user.name.slice(0, 1)}</i><span><strong>{user.name}</strong><small>{user.id}</small></span></div>
                <code>{user.account}</code>
                <div className="user-admin-role"><em className={user.role}>{roleLabel(user.role)}</em><span><strong>{user.role === "expert" ? user.organization : user.site}</strong><small>{user.role === "expert" ? user.specialty : user.team}</small></span></div>
                <span className={`user-admin-status ${user.status}`}><i />{user.status === "active" ? "正常" : "已停用"}</span>
                <div className="user-admin-actions">
                  <button onClick={() => setEditor({ ...user })} title={`编辑 ${user.name}`}><Pencil size={14} /></button>
                  <button onClick={() => { showNotice(`${user.account} 的演示密码已重置为 123456`); }} title={`重置 ${user.name} 的演示密码`}><KeyRound size={14} /></button>
                  <button className={user.status === "active" ? "danger" : "success"} onClick={() => toggleUser(user)}>{user.status === "active" ? "停用" : "启用"}</button>
                </div>
              </article>
            ))}
            {!loading && !visibleUsers.length && <div className="user-admin-empty">没有符合条件的用户</div>}
          </div>
        </section>
      </main>

      {editor && <UserEditor user={editor} onClose={() => setEditor(null)} onSave={saveUser} />}
    </div>
  );
}

function UserEditor({ user, onClose, onSave }) {
  const [form, setForm] = useState(user);
  const [error, setError] = useState("");
  const editing = Boolean(user.id);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
  }

  function submit(event) {
    event.preventDefault();
    if (!form.name.trim() || !form.account.trim()) {
      setError("请填写姓名和登录账号。");
      return;
    }
    const nextError = onSave(form);
    if (nextError) setError(nextError);
  }

  return (
    <div className="user-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="user-editor" onSubmit={submit} role="dialog" aria-modal="true" aria-label={editing ? "编辑用户" : "新增用户"}>
        <header><div><span>{editing ? "EDIT USER" : "CREATE USER"}</span><h2>{editing ? "编辑用户资料" : "新增演示用户"}</h2><p>只维护账号与组织信息，不授予专业内容编辑权限。</p></div><button type="button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
        {error && <div className="user-editor-error">{error}</div>}
        <div className="user-editor-grid">
          <label><span>姓名 <em>必填</em></span><input value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="如：陈志强" autoFocus /></label>
          <label><span>登录账号 <em>必填</em></span><input value={form.account} onChange={(event) => update("account", event.target.value)} placeholder="如：chenzhiqiang" /></label>
          <label><span>角色</span><select value={form.role} onChange={(event) => update("role", event.target.value)}><option value="engineer">工程师</option><option value="expert">专家</option></select></label>
          <label><span>账号状态</span><select value={form.status} onChange={(event) => update("status", event.target.value)}><option value="active">正常</option><option value="disabled">停用</option></select></label>
          {form.role === "engineer" ? <>
            <label className="wide"><span>所属场站</span><input value={form.site} onChange={(event) => update("site", event.target.value)} /></label>
            <label className="wide"><span>班组</span><input value={form.team} onChange={(event) => update("team", event.target.value)} /></label>
          </> : <>
            <label className="wide"><span>所属机构</span><input value={form.organization} onChange={(event) => update("organization", event.target.value)} /></label>
            <label className="wide"><span>专业方向</span><input value={form.specialty} onChange={(event) => update("specialty", event.target.value)} /></label>
          </>}
        </div>
        <footer><button type="button" onClick={onClose}>取消</button><button className="user-admin-primary" type="submit"><Check size={15} />{editing ? "保存修改" : "确认新增"}</button></footer>
      </form>
    </div>
  );
}
