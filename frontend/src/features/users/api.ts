import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query";
import type { Role, User } from "@/types/api";

export function useUsers() {
  return useQuery({
    queryKey: queryKeys.users,
    queryFn: () => api.get<{ items: User[] }>("/users").then((r) => r.items),
  });
}

export interface CreateUserInput {
  email: string;
  full_name: string;
  role: Role;
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserInput) => api.post<{ user: User; temporary_password: string }>("/users", input),
    meta: { silent: true },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.users }),
  });
}

export interface UpdateUserInput {
  id: number;
  full_name?: string;
  role?: Role;
  is_active?: boolean;
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateUserInput) => api.patch<{ user: User }>(`/users/${id}`, data),
    meta: { silent: true },
    onSuccess: ({ user }) => {
      queryClient.setQueryData<User[]>(queryKeys.users, (current) => current?.map((u) => (u.id === user.id ? user : u)));
      void queryClient.invalidateQueries({ queryKey: queryKeys.users });
    },
  });
}

export function useResetPassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<{ temporary_password: string }>(`/users/${id}/reset-password`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.users }),
  });
}
