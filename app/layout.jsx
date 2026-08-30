import './global.css';

export const metadata = {
  title: 'LIFEVEST',
  description: 'Your financial ocean',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
