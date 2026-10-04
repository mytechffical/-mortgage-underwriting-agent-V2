import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'UnderwriteAI — Mortgage Underwriting Workbench',
  description: 'Decision-support workspace for evidence, calculations, policy checks and underwriting findings.',
};

export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="en"><body>{children}</body></html>;
}
