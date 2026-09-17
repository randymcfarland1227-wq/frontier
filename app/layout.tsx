import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://randys-frontier.randymcfarland1227.chatgpt.site'),
  title: 'Randy’s Work Room',
  description: 'One working dashboard for Randy’s job hunt, resale hub, and candle-making site.',
  openGraph: {
    title: 'Randy’s Work Room',
    description: 'Job Hunt · Resale Hub · Candle Making',
    images: [{ url: '/og.png', width: 1672, height: 941, alt: 'Randy’s Work Room — Job Hunt, Resale Hub, and Candle Making' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Randy’s Work Room',
    description: 'Job Hunt · Resale Hub · Candle Making',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <meta name="theme-color" content="#5968e8" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Randy’s Work Room" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
