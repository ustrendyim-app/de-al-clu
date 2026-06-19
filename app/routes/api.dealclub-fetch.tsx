import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const DEALCLUB_BASE_URL = 'https://api.dealclub.de';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const type = url.searchParams.get("type");

  const settings = await prisma.dealclubSettings.findUnique({
    where: { shop: session.shop },
  });
  if (!settings?.apiToken) {
    return { success: false, error: "API Token missing" };
  }
  const apiKey = settings.apiToken;

  if (type === "statuses") {
    try {
      const res = await fetch(`${DEALCLUB_BASE_URL}/api/order/statuses`, {
        cache: 'no-store',
        headers: { 
          'apiKey': apiKey.trim(), 
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Status fetch failed: ${res.status} ${errText}`);
      }
      const data = await res.json();
      return { success: true, statuses: data.filter((s: any) => s.id >= 0) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  if (type === "orders") {
    const statusId = url.searchParams.get("statusId");
    const statusName = url.searchParams.get("statusName") || `Status ${statusId}`;
    const updatedAt = url.searchParams.get("updatedAt") || "0";
    
    try {
      const res = await fetch(`${DEALCLUB_BASE_URL}/api/orders?page=0&size=100&externalStatus=${statusId}&updatedAt=${updatedAt}`, {
        cache: 'no-store',
        headers: { 
          'apiKey': apiKey.trim(), 
          'Accept': 'application/json', 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' 
        }
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Orders fetch failed for status ${statusId}: ${res.status} ${errText}`);
      }
      
      const data = await res.json();
      const rawOrders = Array.isArray(data) ? data : (data.content || []);
      
      const importedOrders = await prisma.importedOrder.findMany({
        where: { shop: session.shop },
        select: { dealclubOrderId: true, status: true, shopifyOrderId: true }
      });
      const importedMap = new Map(importedOrders.map(o => [o.dealclubOrderId, o]));

      const orders = rawOrders.map((order: any) => {
        const orderId = String(order['Order ID'] || order.orderId || order.id || "");
        const importedData = importedMap.get(orderId);
        let syncStatus = importedData?.status === 'SUCCESS' ? 'IMPORTIERT' : 'NEU';
        
        // 4 (Abgebrochen), 5 (Declined), 7 (Canceled)
        const canceledStatusIds = ['4', '5', '7'];
        if (canceledStatusIds.includes(String(order.orderStatus?.id || statusId))) {
           syncStatus = 'STORNIERT';
        }

        const shopifyOrderId = importedData?.shopifyOrderId || null;

        const oDate = order.creationDate ? new Date(parseInt(order.creationDate, 10) * 1000).toLocaleString('de-DE') : '-';
        const total = parseFloat(String(order.total || "0").replace(",", ".")).toFixed(2) + " €";
        
        return {
          id: orderId,
          date: oDate,
          dealclubStatus: order.orderStatus?.statusName || statusName,
          total,
          syncStatus,
          shopifyOrderId,
          creationDateTs: parseInt(order.creationDate || "0", 10),
          rawOrder: order
        };
      });

      return { success: true, orders };
    } catch (e: any) {
       return { success: false, error: e.message };
    }
  }

  return { success: false, error: "Invalid type" };
};
