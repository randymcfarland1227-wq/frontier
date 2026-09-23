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
  metadataBase: new URL('https://frontier-work-room.randymcfarland1227.workers.dev'),
  title: "Randy's Life Hub",
  description: 'One Life Hub for routines, finances, mail, Role Hub, resale, ventures, Move OS, repair log, Self inbox, and more.',
  openGraph: {
    title: "Randy's Life Hub",
    description: 'Eleven origins · one Work Room upgrade',
    images: [{ url: '/og.png', width: 1672, height: 941, alt: "Randy's Life Hub" }],
  },
  twitter: {
    card: 'summary_large_image',
    title: "Randy's Life Hub",
    description: 'Eleven origins · one Work Room upgrade',
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
        <meta name="apple-mobile-web-app-title" content="Life Hub" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
