export const metadata = {
  title: 'LIFEVEST',
  description: 'Your financial ocean',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
