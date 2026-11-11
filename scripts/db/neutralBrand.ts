/**
 * Imported FIRST by generate-seed.ts. The demo seeds interpolate the brand
 * (library "Using <app name>", chat "Welcome to <team> chats!"); supabase/seed.sql
 * is shared by every brand branch, so it is generated with these fixed values
 * instead of whatever src/brand/brand.ts holds.
 */
import { brand } from "@/brand/brand";

Object.assign(brand, { name: "Network Marketing CRM", teamName: "" });
