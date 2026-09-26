import { ArticleScreen } from '@/features/knowledge'

export default async function ArticlePage({ params }: PageProps<'/learn/[slug]'>) {
  const { slug } = await params
  return <ArticleScreen slug={decodeURIComponent(slug)} />
}
