import { Inter } from 'next/font/google';
import './global.css';

/**
 * Self-hosted by Next at build time, so the page makes no request to a font
 * CDN. That keeps `font-src 'self'` honest and removes a third-party dependency
 * from the critical render path.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata = {
  title: 'LIFEVEST',
  description: 'Your financial ocean',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
