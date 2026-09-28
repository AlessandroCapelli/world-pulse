import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./features/world/world-page').then((m) => m.WorldPage) },
  { path: 'metric/:id', loadComponent: () => import('./features/world/world-page').then((m) => m.WorldPage) },
  { path: 'about', loadComponent: () => import('./features/about/about-page').then((m) => m.AboutPage) },
  { path: '**', redirectTo: '' },
];
