alter type public.user_role rename value 'INVENT_ADMIN' to 'ADMIN_INVENT';
alter type public.user_role rename value 'INVENT_USER' to 'INVENT';
alter type public.user_role add value 'ADMIN' before 'ADMIN_INVENT';
