"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, FileText, FolderOpen, LayoutDashboard, LogOut, RefreshCw, Search, UsersRound } from "lucide-react";
import { Button, Card, ErrorAlert, Input, LoadingOverlay, Select, StatusBadge, cn } from "@/components/ui";
import { loadAdminClients, loadAdminDocumentPreview, loadAdminDocuments, loadAdminOverview, type AdminClientSummary, type AdminDocument, type AdminOverview, type Paginated } from "@/services/admin-api";
import { getCurrentPortalAccessToken, getPortalIdentity, signOutFromPortal } from "@/services/portal-auth";
import type { DocumentCategory } from "@/services/assessment-api";

type AdminTab = "overview" | "clients" | "documents";
const statusOptions = [
  ["", "All Statuses"], ["PAYMENT_PENDING", "Payment Pending"], ["PENDING_UPLOADS", "Pending Uploads"], ["READY_FOR_REVIEW", "Ready for Review"], ["IN_PROGRESS", "In Progress"], ["COMPLETED", "Completed"]
] as const;
const categoryLabels: Record<DocumentCategory, string> = {
  TAX_RETURNS: "Prior Tax Returns", W2_INCOME: "W-2 Income", OTHER_INCOME: "Other Income", INVESTMENT_PORTFOLIO: "Investment Portfolio", RETIREMENT_ACCOUNTS: "Retirement Accounts",
  MORTGAGE_STATEMENTS: "Mortgage Statements", BUSINESS_LLC_DOCUMENTS: "Business / LLC", ESTATE_PLAN: "Estate Plan", LIFE_INSURANCE: "Life Insurance", OTHER_ASSESSMENT_DETAILS: "Other Assessment Details"
};
const formatBytes = (value: number) => value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 ** 2).toFixed(1)} MB`;
const fullName = (row: { firstName: string; middleName?: string | null; lastName: string }) => [row.firstName, row.middleName, row.lastName].filter(Boolean).join(" ");

function Status({ label }: { label: string }) {
  const status = label === "Completed" || label === "Ready for Review" ? "complete" : label === "Payment Pending" ? "pending" : "active";
  return <StatusBadge status={status}>{label}</StatusBadge>;
}

export function AdminDashboardClient() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [tab, setTab] = useState<AdminTab>("overview");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [clients, setClients] = useState<Paginated<AdminClientSummary> | null>(null);
  const [documents, setDocuments] = useState<Paginated<AdminDocument> | null>(null);
  const [clientSearchDraft, setClientSearchDraft] = useState(""), [clientSearch, setClientSearch] = useState("");
  const [documentSearchDraft, setDocumentSearchDraft] = useState(""), [documentSearch, setDocumentSearch] = useState("");
  const [status, setStatus] = useState(""), [year, setYear] = useState(""), [category, setCategory] = useState<DocumentCategory | "">("");
  const [clientPage, setClientPage] = useState(1), [documentPage, setDocumentPage] = useState(1);
  const [loading, setLoading] = useState(true), [refreshing, setRefreshing] = useState(false), [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async (accessToken: string, quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const [nextOverview, nextClients, nextDocuments] = await Promise.all([
        loadAdminOverview(accessToken), loadAdminClients(accessToken, { search: clientSearch, status, year, page: clientPage, pageSize: 25 }), loadAdminDocuments(accessToken, { search: documentSearch, category, page: documentPage, pageSize: 25 })
      ]);
      setOverview(nextOverview); setClients(nextClients); setDocuments(nextDocuments);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "We could not load the admin dashboard."); }
    finally { setLoading(false); setRefreshing(false); }
  }, [category, clientPage, clientSearch, documentPage, documentSearch, status, year]);

  useEffect(() => { getCurrentPortalAccessToken().then((accessToken) => {
    if (!accessToken) { router.replace("/login"); return; }
    const identity = getPortalIdentity(accessToken);
    if (identity.role !== "ADMIN" && identity.role !== "SUPER_ADMIN") { router.replace("/portal/dashboard"); return; }
    setToken(accessToken);
  }); }, [router]);

  useEffect(() => { if (token) void loadAll(token); }, [loadAll, token]);

  const cards = useMemo<Array<[string, number]>>(() => overview ? [
    ["All Clients", overview.totalClients], ["Payment Pending", overview.paymentPending], ["Pending Uploads", overview.pendingUploads],
    ["Ready For Review", overview.readyForReview], ["In Progress", overview.inProgress], ["Completed", overview.completed]
  ] : [], [overview]);

  function logout() { signOutFromPortal(); router.replace("/login"); }
  async function preview(document: AdminDocument) {
    try { const result = await loadAdminDocumentPreview(token, document.id); window.open(result.previewUrl, "_blank", "noopener,noreferrer"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "We could not preview this document."); }
  }
  if (loading) return <LoadingOverlay label="Loading assessment administration" />;

  return (
    <section className="page-shell min-h-[80vh] py-8 sm:py-10">
      <Card className="bg-gradient-to-r from-white to-navy-50">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
          <div><StatusBadge status="active">Assessment Administration</StatusBadge><h1 className="mt-3 text-3xl font-bold text-navy-800">Client Operations</h1><p className="mt-2 text-slate-600">Search, review, edit, and advance every assessment from one organized workspace.</p></div>
          <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void loadAll(token, true)} disabled={refreshing}><RefreshCw aria-hidden size={16} className={refreshing ? "animate-spin" : ""} />Refresh</Button><Button variant="outline" onClick={logout}><LogOut aria-hidden size={16} />Logout</Button></div>
        </div>
      </Card>

      <div className="mt-5 grid grid-cols-3 gap-2 rounded-2xl border border-slate-200 bg-white p-2">
        {([ ["overview", "Overview", LayoutDashboard], ["clients", "Clients", UsersRound], ["documents", "All Documents", FolderOpen] ] as const).map(([id, label, Icon]) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={cn("focus-ring flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold transition", tab === id ? "bg-navy-800 text-white" : "text-navy-700 hover:bg-navy-50")}><Icon aria-hidden size={18} />{label}</button>
        ))}
      </div>
      {error ? <div className="mt-5"><ErrorAlert>{error}</ErrorAlert></div> : null}

      {tab === "overview" && overview ? <div className="mt-5 grid gap-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">{cards.map(([label, count]) => <button key={label} type="button" onClick={() => { setTab("clients"); setStatus(label === "All Clients" ? "" : label.toUpperCase().replaceAll(" ", "_")); }} className="focus-ring rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-gold-300"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold text-navy-800">{count}</p></button>)}</div>
        <Card><div className="flex items-center justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-700">Secure Document Library</p><h2 className="mt-2 text-2xl font-bold text-navy-800">{overview.documentCount} files</h2><p className="mt-2 text-slate-600">{formatBytes(overview.documentBytes)} across all assessment years.</p></div><Button variant="outline" onClick={() => setTab("documents")}><FolderOpen aria-hidden size={17} />Browse Documents</Button></div></Card>
        <Card><div className="mb-4"><h2 className="text-xl font-bold text-navy-800">Recently Updated Clients</h2><p className="mt-1 text-sm text-slate-500">Open a client workspace to review or edit the full assessment.</p></div><ClientTable items={clients?.items.slice(0, 8) ?? []} /></Card>
      </div> : null}

      {tab === "clients" ? <div className="mt-5 grid gap-5">
        <Card><div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_220px_160px_auto]"><Input label="Search Clients" placeholder="Name, email, phone, or invoice" value={clientSearchDraft} onChange={(event) => setClientSearchDraft(event.target.value)} /><Select label="Status" value={status} onChange={(event) => { setStatus(event.target.value); setClientPage(1); }}>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select><Select label="Year" value={year} onChange={(event) => { setYear(event.target.value); setClientPage(1); }}><option value="">All Years</option>{overview?.years.map((item) => <option value={item} key={item}>{item}</option>)}</Select><Button className="self-end" onClick={() => { setClientPage(1); setClientSearch(clientSearchDraft.trim()); }}><Search aria-hidden size={17} />Search</Button></div></Card>
        <Card><div className="mb-5 flex items-end justify-between gap-4"><div><h2 className="text-xl font-bold text-navy-800">Clients</h2><p className="mt-1 text-sm text-slate-500">{clients?.total ?? 0} matching assessments</p></div></div><ClientTable items={clients?.items ?? []} /><Pager page={clients?.page ?? 1} totalPages={clients?.totalPages ?? 1} onChange={(next) => setClientPage(next)} /></Card>
      </div> : null}

      {tab === "documents" ? <div className="mt-5 grid gap-5">
        <Card><div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_260px_auto]"><Input label="Search Documents" placeholder="File or client name/email" value={documentSearchDraft} onChange={(event) => setDocumentSearchDraft(event.target.value)} /><Select label="Category" value={category} onChange={(event) => { setCategory(event.target.value as DocumentCategory | ""); setDocumentPage(1); }}><option value="">All Categories</option>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select><Button className="self-end" onClick={() => { setDocumentPage(1); setDocumentSearch(documentSearchDraft.trim()); }}><Search aria-hidden size={17} />Search</Button></div></Card>
        <Card><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-3 py-3">File</th><th className="px-3 py-3">Client</th><th className="px-3 py-3">Category</th><th className="px-3 py-3">Year</th><th className="px-3 py-3">Uploaded</th><th className="px-3 py-3 text-right">Action</th></tr></thead><tbody>{documents?.items.map((document) => <tr key={document.id} className="border-b border-slate-100 hover:bg-slate-50"><td className="px-3 py-4"><span className="flex items-center gap-2 font-semibold text-navy-800"><FileText aria-hidden size={17} />{document.originalName}</span><span className="mt-1 block text-xs text-slate-500">{formatBytes(document.sizeBytes)}</span></td><td className="px-3 py-4"><Link className="font-semibold text-navy-700 hover:underline" href={`/admin/clients/${document.session.id}`}>{fullName(document.session)}</Link><span className="block text-xs text-slate-500">{document.session.normalizedEmail}</span></td><td className="px-3 py-4">{categoryLabels[document.category]}</td><td className="px-3 py-4">{document.session.assessmentYear}</td><td className="px-3 py-4">{new Date(document.createdAt).toLocaleString()}</td><td className="px-3 py-4 text-right"><button className="focus-ring inline-grid size-10 place-items-center rounded-full border border-navy-200 text-navy-700 hover:bg-navy-50" onClick={() => void preview(document)} aria-label={`Preview ${document.originalName}`}><Eye aria-hidden size={17} /></button></td></tr>)}</tbody></table></div>{documents?.items.length === 0 ? <p className="py-12 text-center text-slate-500">No documents match these filters.</p> : null}<Pager page={documents?.page ?? 1} totalPages={documents?.totalPages ?? 1} onChange={setDocumentPage} /></Card>
      </div> : null}
    </section>
  );
}

function ClientTable({ items }: { items: AdminClientSummary[] }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[950px] text-left text-sm"><thead className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-3 py-3">Client</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Year</th><th className="px-3 py-3">Invoice</th><th className="px-3 py-3">Documents</th><th className="px-3 py-3">Updated</th><th className="px-3 py-3 text-right">Open</th></tr></thead><tbody>{items.map((row) => <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50"><td className="px-3 py-4"><span className="font-bold text-navy-800">{fullName(row)}</span><span className="block text-xs text-slate-500">{row.normalizedEmail} · {row.phone}</span></td><td className="px-3 py-4"><Status label={row.statusLabel} /></td><td className="px-3 py-4">{row.assessmentYear}</td><td className="px-3 py-4">{row.qbInvoiceNumber ?? "—"}</td><td className="px-3 py-4">{row.documentCount}</td><td className="px-3 py-4">{new Date(row.updatedAt).toLocaleDateString()}</td><td className="px-3 py-4 text-right"><Link className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-lg border border-navy-200 px-3 font-semibold text-navy-700 hover:bg-navy-50" href={`/admin/clients/${row.id}`}>Open <ChevronRight aria-hidden size={16} /></Link></td></tr>)}</tbody></table>{items.length === 0 ? <p className="py-12 text-center text-slate-500">No clients match these filters.</p> : null}</div>;
}

function Pager({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  return <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-4 text-sm"><span className="text-slate-500">Page {page} of {totalPages}</span><div className="flex gap-2"><Button variant="outline" disabled={page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft aria-hidden size={16} />Previous</Button><Button variant="outline" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Next<ChevronRight aria-hidden size={16} /></Button></div></div>;
}
