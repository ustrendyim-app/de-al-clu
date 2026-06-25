import { useState, useEffect, useCallback, useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { redirect } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate, MONTHLY_PLAN } from "../shopify.server";
import prisma from "../db.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const { hasActivePayment } = await billing.check({
    plans: [MONTHLY_PLAN],
    isTest: true,
  });

  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get('days') || "14", 10);

  const settings = await prisma.dealclubSettings.findUnique({
    where: { shop: session.shop },
  });

  const recentLogs = await prisma.importedOrder.findMany({
    where: { shop: session.shop },
    orderBy: { importedAt: 'desc' },
    take: 10
  });

  return { 
    apiToken: settings?.apiToken || "",
    logs: recentLogs,
    days,
    hasActivePayment
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const formData = await request.formData();
  
  const intent = formData.get("intent")?.toString();
  if (intent === "subscribe") {
    await billing.request({
      plan: MONTHLY_PLAN,
      isTest: true,
    });
    return null;
  }
  
  const apiToken = formData.get("apiToken")?.toString() || "";
  
  if (apiToken) {
    await prisma.dealclubSettings.upsert({
      where: { shop: session.shop },
      update: { apiToken },
      create: { shop: session.shop, apiToken },
    });
  }

  return { success: true };
};

export default function Index() {
  const { apiToken, logs, days, hasActivePayment } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const syncFetcher = useFetcher<any>();
  const shopify = useAppBridge();
  const [searchParams, setSearchParams] = useSearchParams();

  const [lang, setLang] = useState<'de'|'en'>('en');

  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [dealclubOrders, setDealclubOrders] = useState<any[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  
  // Pagination & Filter
  const [currentPage, setCurrentPage] = useState(1);
  const [showOnlyNeu, setShowOnlyNeu] = useState(true);
  const [allowOverwrite, setAllowOverwrite] = useState(false);
  const itemsPerPage = 10;

  const isSaving = fetcher.state === "submitting";
  const isSyncing = syncFetcher.state === "submitting";

  const fetchIdRef = useRef(0);

  const fetchOrdersProgressively = useCallback(async (selectedDays: number) => {
    if (!apiToken || !hasActivePayment) return;
    const currentFetchId = ++fetchIdRef.current;

    setIsLoadingOrders(true);
    setDealclubOrders([]);
    setSelectedOrders([]);
    setCurrentPage(1);

    try {
      const date = new Date();
      date.setDate(date.getDate() - selectedDays);
      const updatedAt = Math.floor(date.getTime() / 1000);
      const cb = Date.now();
      
      const statusRes = await fetch(`/api/dealclub-fetch?type=statuses&updatedAt=${updatedAt}&cb=${cb}`);
      const statusData = await statusRes.json();
      
      if (fetchIdRef.current !== currentFetchId) return;

      if (!statusData.success) {
        throw new Error(statusData.error);
      }
      
      const statuses = statusData.statuses;
      setProgress({ current: 0, total: statuses.length });

      let allFoundOrders: any[] = [];

      for (const status of statuses) {
        if (fetchIdRef.current !== currentFetchId) return;

        try {
          const res = await fetch(`/api/dealclub-fetch?type=orders&statusId=${status.id}&statusName=${encodeURIComponent(status.description || '')}&updatedAt=${updatedAt}&cb=${cb}`);
          const data = await res.json();
          if (data.success && data.orders.length > 0) {
             allFoundOrders = [...allFoundOrders, ...data.orders];
             allFoundOrders.sort((a, b) => b.creationDateTs - a.creationDateTs);
             setDealclubOrders([...allFoundOrders]);
          } else if (!data.success) {
             console.error(`Error for status ${status.id}:`, data.error);
             shopify.toast.show(`API Fehler bei Status ${status.id}: ${data.error}`, { isError: true });
          }
        } catch (e) {
          console.error(`Network error fetching status ${status.id}:`, e);
        }
        setProgress(p => ({ ...p, current: p.current + 1 }));
        await new Promise(r => setTimeout(r, 300));
      }
      
    } catch (e: any) {
      shopify.toast.show(`Fehler: ${e.message}`, { isError: true });
    } finally {
      setIsLoadingOrders(false);
    }
  }, [apiToken, shopify, hasActivePayment]);

  useEffect(() => {
    fetchOrdersProgressively(days);
  }, [days, fetchOrdersProgressively]);

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show(lang === 'de' ? "Einstellungen erfolgreich gespeichert." : "Settings successfully saved.");
    } else if (fetcher.data?.error) {
      shopify.toast.show(`Error: ${fetcher.data.error}`, { isError: true });
    }
  }, [fetcher.data, shopify, lang]);

  useEffect(() => {
    if (syncFetcher.data?.success) {
      shopify.toast.show(lang === 'de' ? `Synchronisierung abgeschlossen! ${syncFetcher.data.count} Bestellungen importiert.` : `Sync complete! ${syncFetcher.data.count} orders imported.`);
      setSelectedOrders([]);
      fetchOrdersProgressively(days);
    } else if (syncFetcher.data?.error) {
      shopify.toast.show(`Error: ${syncFetcher.data.error}`, { isError: true });
    }
  }, [syncFetcher.data, shopify, days, fetchOrdersProgressively, lang]);

  const handleDaysChange = (d: number) => {
    setSearchParams({ days: d.toString() });
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const pageOrders = paginatedOrders.filter((o: any) => o.syncStatus === 'NEU');
      setSelectedOrders(pageOrders.map((o: any) => o.id));
    } else {
      setSelectedOrders([]);
    }
  };

  const handleSelect = (id: string) => {
    setSelectedOrders(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const t = {
    subRequired: lang === 'de' ? "Abonnement erforderlich" : "Subscription Required",
    subDetails: lang === 'de' ? "Ihre Abonnement-Details" : "Your Subscription Details",
    subText: lang === 'de' ? "Sie haben derzeit kein aktives Abonnement. Um die DealClub Bestellungen mit Shopify zu synchronisieren, ist das Standard-Abo erforderlich." : "You currently have no active subscription. To sync DealClub orders with Shopify, the Standard Plan is required.",
    standardPlan: lang === 'de' ? "Standard-Abo" : "Standard Plan",
    month: lang === 'de' ? "Monat" : "Month",
    subBtn: isSaving ? (lang === 'de' ? "Wird verarbeitet..." : "Processing...") : (lang === 'de' ? "Jetzt Abonnieren" : "Subscribe Now"),
    autoSync: lang === 'de' ? "Automatische Bestell-Synchronisation" : "Automatic Order Synchronization",
    seamlessApi: lang === 'de' ? "Nahtlose API Integration" : "Seamless API Integration",
    realtime: lang === 'de' ? "Echtzeit-Aktualisierung" : "Real-time Updates",
    reliable: lang === 'de' ? "Zuverlässiger Datenimport" : "Reliable Data Import",
    settingsTitle: lang === 'de' ? "Dealclub Bestellimport Einstellungen" : "Dealclub Order Import Settings",
    apiConnection: lang === 'de' ? "API-Verbindung" : "API Connection",
    apiDesc: lang === 'de' ? "Geben Sie hier Ihren Dealclub Kunden-Token (API-Key) ein, um Bestellungen in Ihren Shopify-Shop zu importieren." : "Enter your Dealclub Customer Token (API-Key) here to import orders into your Shopify store.",
    tokenLabel: lang === 'de' ? "Kunden-Token (API-Key)" : "Customer Token (API-Key)",
    noTokenDesc: lang === 'de' ? "Sie haben noch keinen API-Key? Fordern Sie diesen ganz einfach über unser Kontaktformular an oder schreiben Sie uns eine E-Mail an info@dealclub.de (Tel: 02131/3849851)." : "Don't have an API-Key yet? Request one easily via our contact form or send us an email at info@dealclub.de.",
    saveBtn: isSaving ? (lang === 'de' ? "Speichern..." : "Saving...") : (lang === 'de' ? "Einstellungen speichern" : "Save Settings"),
    manualSync: lang === 'de' ? "Manuelle Bestellsynchronisation" : "Manual Order Synchronization",
    manualDesc: lang === 'de' ? "Ihre neuesten Bestellungen auf Dealclub sind unten aufgelistet. Sie können 'NEU'-Bestellungen auswählen, die noch nicht zu Shopify übertragen wurden, und diese importieren." : "Your latest Dealclub orders are listed below. You can select 'NEW' orders that haven't been transferred to Shopify yet and import them.",
    timeframe: lang === 'de' ? "1. Zeitraum wählen:" : "1. Select Timeframe:",
    days5: lang === 'de' ? "Letzte 5 Tage" : "Last 5 Days",
    days7: lang === 'de' ? "Letzte 1 Woche" : "Last 1 Week",
    days14: lang === 'de' ? "Letzte 14 Tage" : "Last 14 Days",
    filterView: lang === 'de' ? "2. Ansicht filtern:" : "2. Filter View:",
    onlyNew: lang === 'de' ? 'Nur "NEU" anzeigen' : 'Show Only "NEW"',
    showAll: lang === 'de' ? 'Alle anzeigen (inkl. Importierte)' : 'Show All (incl. Imported)',
    loading: lang === 'de' ? "Dealclub-Bestellungen werden abgerufen..." : "Fetching Dealclub orders...",
    date: lang === 'de' ? "Datum" : "Date",
    statusDC: lang === 'de' ? "Status (Dealclub)" : "Status (Dealclub)",
    amount: lang === 'de' ? "Betrag" : "Amount",
    syncStatus: lang === 'de' ? "Übertragungsstatus" : "Transfer Status",
    noOrders: lang === 'de' ? "Es wurden keine Bestellungen gefunden." : "No orders found.",
    viewShopify: lang === 'de' ? "In Shopify ansehen" : "View in Shopify",
    totalOrders: lang === 'de' ? "Gesamt:" : "Total:",
    ordersWord: lang === 'de' ? "Bestellungen" : "Orders",
    prev: lang === 'de' ? "Zurück" : "Prev",
    next: lang === 'de' ? "Weiter" : "Next",
    pageOf: (c: number, t: number) => lang === 'de' ? `Seite ${c} von ${t}` : `Page ${c} of ${t}`,
    allowOverwrite: lang === 'de' ? "Erneuten Import bereits importierter Bestellungen zulassen (Überschreiben)" : "Allow re-import of already imported orders (Overwrite)",
    importBtn: isSyncing ? (lang === 'de' ? "Wird importiert..." : "Importing...") : (lang === 'de' ? `Ausgewählte importieren (${selectedOrders.length})` : `Import Selected (${selectedOrders.length})`),
    selectPrompt: lang === 'de' ? "Wählen Sie eine Bestellung aus der Tabelle aus, um sie zu importieren." : "Select an order from the table to import it.",
    logsTitle: lang === 'de' ? "Letzte Synchronisationsprotokolle" : "Recent Synchronization Logs",
    noLogs: lang === 'de' ? "Es wurden noch keine Bestellungen importiert." : "No orders have been imported yet.",
    errorIfAny: lang === 'de' ? "Fehler (falls vorhanden)" : "Error (if any)"
  };

  const TopToggle = () => (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
      <button onClick={() => setLang('en')} style={{ padding: '0.4rem', marginRight: '0.5rem', cursor: 'pointer', fontWeight: lang === 'en' ? 'bold' : 'normal', background: lang === 'en' ? '#e1e3e5' : '#fff', border: '1px solid #c9cccf', borderRadius: '4px' }}>🇬🇧 English</button>
      <button onClick={() => setLang('de')} style={{ padding: '0.4rem', cursor: 'pointer', fontWeight: lang === 'de' ? 'bold' : 'normal', background: lang === 'de' ? '#e1e3e5' : '#fff', border: '1px solid #c9cccf', borderRadius: '4px' }}>🇩🇪 Deutsch</button>
    </div>
  );

  if (!hasActivePayment) {
    return (
      <s-page fullWidth={false}>
        <TopToggle />
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2rem' }}>
          <img src="/logo.png" alt="Dealclub Logo" style={{ height: '40px', marginRight: '1rem' }} />
          <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: 0 }}>{t.subRequired}</h1>
        </div>
        
        <s-section heading={t.subDetails}>
          <s-paragraph>{t.subText}</s-paragraph>

          <div style={{ marginTop: '2rem', padding: '1.5rem', border: '1px solid #c9cccf', borderRadius: '8px', maxWidth: '400px', backgroundColor: '#fff' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>{t.standardPlan}</h2>
            <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#008060', marginBottom: '1rem' }}>$5.49 <span style={{ fontSize: '1rem', color: '#666', fontWeight: 'normal' }}>/ {t.month}</span></p>
            <ul style={{ paddingLeft: '1.2rem', marginBottom: '1.5rem', lineHeight: '1.8' }}>
              <li>{t.autoSync}</li>
              <li>{t.seamlessApi}</li>
              <li>{t.realtime}</li>
              <li>{t.reliable}</li>
            </ul>

            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="subscribe" />
              <s-button type="submit" variant="primary" fullWidth {...(isSaving ? { loading: true } : {})}>
                {t.subBtn}
              </s-button>
            </fetcher.Form>
          </div>
        </s-section>
      </s-page>
    );
  }

  const filteredOrders = showOnlyNeu 
    ? dealclubOrders.filter((o: any) => o.syncStatus === 'NEU')
    : dealclubOrders;

  const totalPages = Math.ceil(filteredOrders.length / itemsPerPage) || 1;
  const paginatedOrders = filteredOrders.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  
  const progressPercent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  const selectedOrdersData = dealclubOrders.filter((o: any) => selectedOrders.includes(o.id)).map((o: any) => o.rawOrder);

  return (
    <s-page fullWidth={false}>
      <TopToggle />
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2rem' }}>
        <img src="/logo.png" alt="Dealclub Logo" style={{ height: '40px', marginRight: '1rem' }} />
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: 0 }}>{t.settingsTitle}</h1>
      </div>
      <s-section heading={t.apiConnection}>
        <s-paragraph>{t.apiDesc}</s-paragraph>
        
        <fetcher.Form method="post" style={{ marginTop: '1rem' }}>
          <s-stack direction="block" gap="base">
            <div>
              <label htmlFor="apiToken" style={{display: 'block', marginBottom: '0.5rem', fontWeight: 'bold'}}>{t.tokenLabel}</label>
              <input 
                id="apiToken"
                name="apiToken" 
                defaultValue={apiToken}
                placeholder="API-Key"
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px' }}
                required
              />
              <div style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: '#666' }}>
                {t.noTokenDesc}
              </div>
            </div>
            
            <s-button type="submit" variant="primary" {...(isSaving ? { loading: true } : {})}>
              {t.saveBtn}
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>

      {apiToken && (
        <s-section heading={t.manualSync}>
          <s-paragraph>{t.manualDesc}</s-paragraph>

          <div style={{ marginTop: '1.5rem', marginBottom: '0.5rem', fontWeight: 'bold' }}>{t.timeframe}</div>
          <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '0.5rem' }}>
            <button 
              onClick={() => handleDaysChange(5)} 
              disabled={isLoadingOrders}
              style={{ padding: '0.5rem 1rem', cursor: isLoadingOrders ? 'not-allowed' : 'pointer', backgroundColor: days === 5 ? '#303030' : '#fff', color: days === 5 ? '#fff' : '#303030', border: '1px solid #c9cccf', borderRadius: '4px', opacity: isLoadingOrders ? 0.6 : 1 }}
            >{t.days5}</button>
            <button 
              onClick={() => handleDaysChange(7)} 
              disabled={isLoadingOrders}
              style={{ padding: '0.5rem 1rem', cursor: isLoadingOrders ? 'not-allowed' : 'pointer', backgroundColor: days === 7 ? '#303030' : '#fff', color: days === 7 ? '#fff' : '#303030', border: '1px solid #c9cccf', borderRadius: '4px', opacity: isLoadingOrders ? 0.6 : 1 }}
            >{t.days7}</button>
            <button 
              onClick={() => handleDaysChange(14)} 
              disabled={isLoadingOrders}
              style={{ padding: '0.5rem 1rem', cursor: isLoadingOrders ? 'not-allowed' : 'pointer', backgroundColor: days === 14 ? '#303030' : '#fff', color: days === 14 ? '#fff' : '#303030', border: '1px solid #c9cccf', borderRadius: '4px', opacity: isLoadingOrders ? 0.6 : 1 }}
            >{t.days14}</button>
          </div>

          <div style={{ marginBottom: '0.5rem', fontWeight: 'bold' }}>{t.filterView}</div>
          <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem', backgroundColor: '#f4f6f8', padding: '0.5rem', borderRadius: '4px', border: '1px solid #e1e3e5' }}>
            <button 
              onClick={() => { setShowOnlyNeu(true); setCurrentPage(1); }} 
              style={{ padding: '0.4rem 0.8rem', cursor: 'pointer', backgroundColor: showOnlyNeu ? '#cbe5fe' : '#fff', color: showOnlyNeu ? '#004182' : '#303030', border: '1px solid #c9cccf', borderRadius: '4px', fontWeight: showOnlyNeu ? 'bold' : 'normal' }}
            >{t.onlyNew}</button>
            <button 
              onClick={() => { setShowOnlyNeu(false); setCurrentPage(1); }} 
              style={{ padding: '0.4rem 0.8rem', cursor: 'pointer', backgroundColor: !showOnlyNeu ? '#aee9d1' : '#fff', color: !showOnlyNeu ? '#0b5136' : '#303030', border: '1px solid #c9cccf', borderRadius: '4px', fontWeight: !showOnlyNeu ? 'bold' : 'normal' }}
            >{t.showAll}</button>
          </div>

          {isLoadingOrders && (
            <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: '#f4f6f8', borderRadius: '4px', border: '1px solid #e1e3e5' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ fontWeight: 'bold' }}>{t.loading}</span>
                <span style={{ fontWeight: 'bold', color: '#008060' }}>{progressPercent}%</span>
              </div>
              <div style={{ width: '100%', height: '8px', backgroundColor: '#e1e3e5', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ width: `${progressPercent}%`, height: '100%', backgroundColor: '#008060', transition: 'width 0.3s ease' }}></div>
              </div>
            </div>
          )}
          
          <div style={{ marginTop: '1rem', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', border: '1px solid #e1e3e5' }}>
              <thead style={{ backgroundColor: '#f4f6f8' }}>
                <tr style={{ borderBottom: '1px solid #e1e3e5' }}>
                  <th style={{ padding: '0.75rem', width: '40px', textAlign: 'center' }}>
                    <input 
                      type="checkbox" 
                      onChange={handleSelectAll}
                      checked={paginatedOrders.filter((o:any)=>o.syncStatus==='NEU').length > 0 && selectedOrders.length === paginatedOrders.filter((o:any)=>o.syncStatus==='NEU').length}
                      disabled={paginatedOrders.filter((o:any)=>o.syncStatus==='NEU').length === 0}
                    />
                  </th>
                  <th style={{ padding: '0.75rem' }}>ID</th>
                  <th style={{ padding: '0.75rem' }}>{t.date}</th>
                  <th style={{ padding: '0.75rem' }}>{t.statusDC}</th>
                  <th style={{ padding: '0.75rem' }}>{t.amount}</th>
                  <th style={{ padding: '0.75rem' }}>{t.syncStatus}</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.length === 0 && !isLoadingOrders ? (
                  <tr><td colSpan={6} style={{ padding: '1rem', textAlign: 'center' }}>{t.noOrders}</td></tr>
                ) : (
                  paginatedOrders.map((order: any) => (
                    <tr key={order.id} style={{ borderBottom: '1px solid #e1e3e5', backgroundColor: order.syncStatus === 'NEU' ? '#f0f7ff' : '#f4f6f8' }}>
                      <td style={{ padding: '0.8rem', borderBottom: '1px solid #e1e3e5' }}>
                        <input 
                          type="checkbox" 
                          checked={selectedOrders.includes(order.id)}
                          onChange={() => handleSelect(order.id)}
                          disabled={order.syncStatus === 'STORNIERT' || (order.syncStatus === 'IMPORTIERT' && !allowOverwrite)}
                        />
                      </td>
                      <td style={{ padding: '0.8rem', borderBottom: '1px solid #e1e3e5' }}>{order.id}</td>
                      <td style={{ padding: '0.8rem', borderBottom: '1px solid #e1e3e5' }}>{order.date}</td>
                      <td style={{ padding: '0.8rem', borderBottom: '1px solid #e1e3e5' }}>{order.dealclubStatus}</td>
                      <td style={{ padding: '0.8rem', borderBottom: '1px solid #e1e3e5' }}>{order.total}</td>
                      <td style={{ padding: '0.8rem', borderBottom: '1px solid #e1e3e5' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ 
                            padding: '0.2rem 0.5rem', 
                            borderRadius: '4px', 
                            fontSize: '0.85rem', 
                            fontWeight: 'bold',
                            backgroundColor: order.syncStatus === 'IMPORTIERT' ? '#cce8d6' : order.syncStatus === 'STORNIERT' ? '#fed3d1' : '#cbe5fe',
                            color: order.syncStatus === 'IMPORTIERT' ? '#006e2a' : order.syncStatus === 'STORNIERT' ? '#8c1106' : '#004182'
                          }}>
                            {order.syncStatus === 'NEU' && lang === 'en' ? 'NEW' :
                             order.syncStatus === 'IMPORTIERT' && lang === 'en' ? 'IMPORTED' :
                             order.syncStatus === 'STORNIERT' && lang === 'en' ? 'CANCELLED' :
                             order.syncStatus}
                          </span>
                          {order.shopifyOrderId && (
                            <a 
                              href={`shopify:admin/orders/${order.shopifyOrderId}`}
                              target="_top"
                              style={{
                                fontSize: '0.8rem',
                                padding: '0.2rem 0.5rem',
                                backgroundColor: '#fff',
                                border: '1px solid #c9cccf',
                                borderRadius: '4px',
                                textDecoration: 'none',
                                color: '#202223'
                              }}
                            >
                              {t.viewShopify}
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          
          {filteredOrders.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', padding: '0.5rem 0' }}>
              <div style={{ color: '#666', fontSize: '0.9rem' }}>
                {t.totalOrders} {filteredOrders.length} {t.ordersWord}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button 
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  style={{ padding: '0.4rem 0.8rem', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', border: '1px solid #c9cccf', borderRadius: '4px', backgroundColor: '#fff', opacity: currentPage === 1 ? 0.5 : 1 }}
                >
                  {t.prev}
                </button>
                <span style={{ fontSize: '0.9rem' }}>{t.pageOf(currentPage, totalPages)}</span>
                <button 
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  style={{ padding: '0.4rem 0.8rem', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer', border: '1px solid #c9cccf', borderRadius: '4px', backgroundColor: '#fff', opacity: currentPage === totalPages ? 0.5 : 1 }}
                >
                  {t.next}
                </button>
              </div>
            </div>
          )}

          <div style={{ marginTop: '1.5rem', marginBottom: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input 
                type="checkbox" 
                id="allowOverwrite" 
                checked={allowOverwrite} 
                onChange={(e) => setAllowOverwrite(e.target.checked)} 
              />
              <label htmlFor="allowOverwrite" style={{ cursor: 'pointer', fontSize: '0.9rem', color: '#333' }}>
                {t.allowOverwrite}
              </label>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <syncFetcher.Form method="post" action="/api/sync">
                <input type="hidden" name="selectedOrdersData" value={JSON.stringify(selectedOrdersData)} />
                <input type="hidden" name="forceOverwrite" value={allowOverwrite.toString()} />
                <s-button type="submit" variant="primary" disabled={selectedOrders.length === 0 || isLoadingOrders} {...(isSyncing ? { loading: true } : {})}>
                  {t.importBtn}
                </s-button>
              </syncFetcher.Form>
              {selectedOrders.length === 0 && <span style={{color: '#666', fontSize: '0.9rem'}}>{t.selectPrompt}</span>}
            </div>
          </div>

          <s-heading>{t.logsTitle}</s-heading>
          {logs.length === 0 ? (
            <s-paragraph>{t.noLogs}</s-paragraph>
          ) : (
            <div style={{ marginTop: '1rem', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #ccc' }}>
                    <th style={{ padding: '0.5rem' }}>{t.date}</th>
                    <th style={{ padding: '0.5rem' }}>Dealclub ID</th>
                    <th style={{ padding: '0.5rem' }}>Shopify ID</th>
                    <th style={{ padding: '0.5rem' }}>Status</th>
                    <th style={{ padding: '0.5rem' }}>{t.errorIfAny}</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log: any) => (
                    <tr key={log.id} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '0.5rem' }}>{new Date(log.importedAt).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US')}</td>
                      <td style={{ padding: '0.5rem' }}>{log.dealclubOrderId}</td>
                      <td style={{ padding: '0.5rem' }}>{log.shopifyOrderId || '-'}</td>
                      <td style={{ padding: '0.5rem' }}>
                        <span style={{ 
                          padding: '0.2rem 0.5rem', 
                          borderRadius: '4px',
                          background: log.status === 'SUCCESS' ? '#aee9d1' : log.status === 'FAILED' ? '#fed3d1' : '#e4e5e7',
                          color: log.status === 'SUCCESS' ? '#0b5136' : log.status === 'FAILED' ? '#8e1f0b' : '#303030',
                          fontSize: '0.85rem'
                        }}>
                          {log.status === 'SUCCESS' ? (lang === 'de' ? 'ERFOLG' : 'SUCCESS') : (lang === 'de' ? 'FEHLER' : 'ERROR')}
                        </span>
                      </td>
                      <td style={{ padding: '0.5rem' }}>{log.errorMessage || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
