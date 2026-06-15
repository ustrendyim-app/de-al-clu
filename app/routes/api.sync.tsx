import type { ActionFunctionArgs } from "react-router";
import { authenticate, apiVersion } from "../shopify.server";
import prisma from "../db.server";
import { fetchDealclubOrders, mapDealclubToShopifyOrder } from "../services/dealclub.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  
  const selectedOrdersDataStr = formData.get("selectedOrdersData")?.toString() || "[]";
  let dealclubOrders: any[] = [];
  try {
    dealclubOrders = JSON.parse(selectedOrdersDataStr);
  } catch (e) {
    dealclubOrders = [];
  }

  if (dealclubOrders.length === 0) {
    return { success: false, error: "Aktarılacak sipariş listesi bulunamadı." };
  }

  const settings = await prisma.dealclubSettings.findUnique({
    where: { shop: session.shop },
  });

  if (!settings?.apiToken) {
    return { success: false, error: "Dealclub API Key bulunamadı. Lütfen önce ayarları kaydedin." };
  }

  const ordersToSync = dealclubOrders;

  const forceOverwriteStr = formData.get("forceOverwrite")?.toString() || "false";
  const forceOverwrite = forceOverwriteStr === "true";

  let importedCount = 0;
  for (const order of ordersToSync) {
    const orderId = String(order['Order ID'] || order.orderId || order.id || "");
    if (!orderId) continue;

    const existingLog = await prisma.importedOrder.findUnique({
      where: {
        shop_dealclubOrderId: { shop: session.shop, dealclubOrderId: orderId }
      }
    });

    if (existingLog && existingLog.status === "SUCCESS" && !forceOverwrite) {
      continue;
    }

    try {
      const payload = mapDealclubToShopifyOrder(order);
      
      const url = `https://${session.shop}/admin/api/${apiVersion}/orders.json`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': session.accessToken || "",
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ order: payload })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(JSON.stringify(data.errors || data));
      }

      await prisma.importedOrder.upsert({
        where: { shop_dealclubOrderId: { shop: session.shop, dealclubOrderId: orderId } },
        update: { status: "SUCCESS", shopifyOrderId: String(data.order.id), errorMessage: null },
        create: { shop: session.shop, dealclubOrderId: orderId, shopifyOrderId: String(data.order.id), status: "SUCCESS" }
      });
      importedCount++;

    } catch (err: any) {
      await prisma.importedOrder.upsert({
        where: { shop_dealclubOrderId: { shop: session.shop, dealclubOrderId: orderId } },
        update: { status: "FAILED", errorMessage: err.message || "Unknown error" },
        create: { shop: session.shop, dealclubOrderId: orderId, status: "FAILED", errorMessage: err.message || "Unknown error" }
      });
    }
  }

  return { success: true, count: importedCount };
};
