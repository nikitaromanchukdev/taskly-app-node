export type Priority = 'low' | 'medium' | 'high'
export interface TodoInput {
  title: string
  description: string
  priority: Priority
  due_date: string | null
  completed: boolean
}
export interface Todo extends TodoInput {
  id: number
  created_at: string
  updated_at: string
}
export type Filter = 'all' | 'active' | 'completed'
export type Sort = 'newest' | 'priority' | 'due'
export interface TodoStats {
  total: number
  open: number
  completed: number
  by_priority: Record<Priority, number>
  overdue: number
}
