# Third-party notices

Bunya is MIT licensed (see `LICENSE`). It includes material from the third
parties below, under their own terms. Rule sources that are re-encoded rather
than copied are listed with their licences in `project-docs/rules/SOURCES.md`.

## Azure Policy built-in metadata

`lib/rules/compliance/policy-metadata.generated.ts` contains policy display
names, versions, parameter shapes and regulatory-compliance control IDs copied
by `pnpm compliance:sync` from [Azure/azure-policy](https://github.com/Azure/azure-policy).
No framework (CIS, PCI DSS, HITRUST) text is included.

```
MIT License

Copyright (c) Microsoft Corporation. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Azure Quickstart Templates

`e2e/fixtures/arm/` holds five templates from
[Azure/azure-quickstart-templates](https://github.com/Azure/azure-quickstart-templates),
used only as import test inputs (see `e2e/fixtures/arm/README.md`).

```
The MIT License (MIT)

Copyright (c) 2015 Microsoft Azure

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Azure architecture icons

The SVGs in `public/azure-icons/` (and the published copies in `docs/azure-icons/`)
are unmodified icons from Microsoft's
[Azure architecture icons](https://learn.microsoft.com/en-us/azure/architecture/icons/)
pack, listed in `lib/catalogue/icon-manifest.json`. They are Microsoft's
property, are not covered by Bunya's MIT licence, and are used under
Microsoft's terms for architecture diagrams. See "Microsoft icon usage" in the
README.
