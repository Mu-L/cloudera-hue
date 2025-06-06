#!/usr/bin/env python
# Licensed to Cloudera, Inc. under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  Cloudera, Inc. licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import sys
import logging

from django.urls import re_path

LOG = logging.getLogger()

try:
  from djangosaml2 import views as djangosaml2_views

  from libsaml import views as libsaml_views
except ImportError:
  LOG.warning('djangosaml2 module not found')
  djangosaml2_views = None

try:
  from djangosaml2.views import logout_service_post
except ImportError:
  # We are on an older version of djangosaml2
  logout_service_post = None


if djangosaml2_views is not None:
  urlpatterns = [
    re_path(r'^logout/$', djangosaml2_views.LogoutView.as_view(), name='saml2_logout')
  ]

  urlpatterns += [
    re_path(r'^ls/$', libsaml_views.LogoutView.as_view(), name='saml2_ls'),
    re_path(r'^acs/$', libsaml_views.CustomAssertionConsumerServiceView.as_view(), name='saml2_acs'),
    re_path(r'^login/$', libsaml_views.LoginView.as_view(), name='saml2_login'),
    re_path(r'^metadata/$', libsaml_views.MetadataView.as_view(), name='saml2_metadata'),
    re_path(r'^test/$', libsaml_views.EchoAttributesView.as_view())
  ]

  if logout_service_post is not None:
    urlpatterns += [
      re_path(r'^ls/post/$', libsaml_views.LogoutServicePostView.as_view(), name='saml2_ls_post')
    ]
