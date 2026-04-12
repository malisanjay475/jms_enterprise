export const metadata = {
  title: 'JMS Enterprise V2',
  description: 'Multi-Factory Enterprise Management System',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
