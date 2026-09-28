import { ApplicationConfig, mergeApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { CATALOG_SOURCE } from './core/data/catalog-source';
import { serverCatalogSource } from './core/data/server-catalog-source';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    { provide: CATALOG_SOURCE, useValue: serverCatalogSource },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
