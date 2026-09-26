<#
.SYNOPSIS
  Añade filas nuevas al final de la tabla del acta de un contratista (hoja
  CORTOS-INTERNOS-PUTANA u homóloga), trabajando SIEMPRE sobre una COPIA del
  libro original. Nunca modifica -Libro.

.DESCRIPCION
  - Copia -Libro a -Salida (si -Salida ya existe, error: nunca se sobrescribe).
  - Abre la copia con Excel (COM), invisible, sin alertas.
  - Localiza la ListObject de -Hoja cuyos encabezados incluyan 'Acta No.' y
    'Fecha' (fila 8 en el acta real), y le agrega, al final, una fila por
    cada elemento de -Filas (json).
  - Escribe SOLO columnas de entrada: Fecha (texto dd/mm/aaaa), Frente de
    Obra o UF, Actividad, Centro de costo, Remisión, Código equipo o Placa,
    Kilometraje Inicial, Kilometraje Final, Cantidad transportada (m3),
    Unidad.
  - Columnas calculadas de la tabla (Día sem, Dia hábil, Kilómetros Stand by,
    Total Kilómetros a pagar) se copian con la MISMA fórmula que trae la
    tabla (estructura #This Row/estructurada, válida para cualquier fila).
  - 'Acta No.' se escribe con la fórmula UF1/UF2 de la última fila, pero con
    los dos textos entre comillas sustituidos por los provisionales
    ("MEMORIA UF1 — POR DEFINIR" / "MEMORIA UF2 — POR DEFINIR").
  - 'Kilómetros Totales trabajados' (M) y 'Transporte de material m3*Km' (Q)
    SÍ son columna calculada de la tabla: Excel las autocompleta solas al
    agregar la fila (ListRows.Add), M = (KmFin-KmIni)/1000 y Q = Cantidad*M.
    Si Kilometraje Inicial no es numérico (p. ej. "Planta Putana"), esa
    fórmula de M da #VALOR!: se sobrescribe M con el literal 'kmTot' que
    traiga la fila del json (Q recalcula solo, porque su fórmula referencia
    a M por nombre de columna).
    En libros donde M y Q son valores literales (p. ej. D&S.xlsx, hoja «D&S»):
    la fórmula de M con ABS solo se exige si alguna fila trae Kilometraje
    Inicial numérico, y si Q no quedó con fórmula se le pone =Cantidad*M.
  - 'Observaciones' se copia con la fórmula de la tabla, salvo que la fila
    del json traiga 'obs' explícita (TM1/PUENTES con texto ya resuelto):
    en ese caso se escribe ese texto literal, sobrescribiendo la fórmula.
  - Refresca las tablas dinámicas de la hoja (salvo -SinRefrescar).
  - Guarda, cierra el libro y libera Excel siempre (try/finally).

.PARAMETER Libro
  Ruta al acta del contratista (NUNCA se modifica).

.PARAMETER Filas
  Ruta a un archivo .json, o el texto json en línea, con la lista de filas:
  [{fecha:'dd/mm/aaaa', uf, actividad, cc, remision, placa, kmIni, kmFin,
    kmTot?, m3, unidad:'m3km', obs?}, ...]

.PARAMETER Salida
  Ruta de la copia a crear (si existe, error).

.PARAMETER Hoja
  Nombre de la hoja del acta. Por defecto 'CORTOS-INTERNOS-PUTANA'.

.PARAMETER SinRefrescar
  Si se indica, no refresca las tablas dinámicas de la hoja.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Libro,
    [Parameter(Mandatory = $true)][string]$Filas,
    [Parameter(Mandatory = $true)][string]$Salida,
    [string]$Hoja = 'CORTOS-INTERNOS-PUTANA',
    [switch]$SinRefrescar
)

$ErrorActionPreference = 'Stop'

# --- Provisionales para 'Acta No.' (D-xx pendiente: el compañero las reemplaza) ---
# Se construye con [char]0x2014 (raya larga) en vez de escribir el carácter
# literal en el archivo, para no depender de la codificación con que
# PowerShell 5.1 (sin BOM) lea este .ps1.
$RayaLarga = [char]0x2014
$TextoProvisionalUF1 = "MEMORIA UF1 $RayaLarga POR DEFINIR"
$TextoProvisionalUF2 = "MEMORIA UF2 $RayaLarga POR DEFINIR"

function Buscar-Columna {
    param($HeaderRowRange, [string[]]$Patrones)
    for ($i = 1; $i -le $HeaderRowRange.Columns.Count; $i++) {
        $texto = [string]$HeaderRowRange.Cells.Item(1, $i).Text
        foreach ($p in $Patrones) {
            if ($texto -like $p) { return $i }
        }
    }
    return $null
}

function Es-Numerico {
    param([string]$Texto)
    $tmp = 0.0
    return [double]::TryParse($Texto, [ref]$tmp)
}

# --- 1) Validar entradas ---
if (-not (Test-Path -LiteralPath $Libro)) {
    throw "No existe -Libro: $Libro"
}
if (Test-Path -LiteralPath $Salida) {
    throw "-Salida ya existe, no se sobrescribe: $Salida"
}

if (Test-Path -LiteralPath $Filas) {
    $filasJsonTexto = Get-Content -LiteralPath $Filas -Raw -Encoding UTF8
} else {
    $filasJsonTexto = $Filas
}
$filasParseadas = ConvertFrom-Json -InputObject $filasJsonTexto
if ($filasParseadas -is [System.Array]) {
    $filasEntrada = $filasParseadas
} else {
    $filasEntrada = @($filasParseadas)
}
if ($filasEntrada.Count -eq 0) {
    throw "-Filas no trae ninguna fila"
}

# --- 2) Copiar el libro (nunca se toca el original) ---
Copy-Item -LiteralPath $Libro -Destination $Salida -ErrorAction Stop

$excel = $null
$libroCom = $null
$resumen = $null

try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.AskToUpdateLinks = $false

    $libroCom = $excel.Workbooks.Open((Resolve-Path -LiteralPath $Salida).Path)
    $ws = $libroCom.Worksheets.Item($Hoja)

    # --- 3) Localizar la ListObject por encabezados ---
    $lo = $null
    foreach ($t in $ws.ListObjects) {
        $hdr = $t.HeaderRowRange
        $tieneActa = $false
        $tieneFecha = $false
        for ($i = 1; $i -le $hdr.Columns.Count; $i++) {
            $txt = [string]$hdr.Cells.Item(1, $i).Text
            if ($txt -like 'Acta No*') { $tieneActa = $true }
            if ($txt -eq 'Fecha') { $tieneFecha = $true }
        }
        if ($tieneActa -and $tieneFecha) { $lo = $t; break }
    }
    if (-not $lo) {
        throw "No se encontró en la hoja '$Hoja' una tabla con encabezados 'Acta No.' y 'Fecha'"
    }

    $hdr = $lo.HeaderRowRange
    $colFecha = Buscar-Columna $hdr @('Fecha')
    $colUF = Buscar-Columna $hdr @('*Frente de Obra*UF*')
    $colActividad = Buscar-Columna $hdr @('Actividad')
    $colCC = Buscar-Columna $hdr @('*Centro de costo*')
    $colRemision = Buscar-Columna $hdr @('Remisi*n')
    $colPlaca = Buscar-Columna $hdr @('*quipo*Placa*', '*Placa*')
    $colKmIni = Buscar-Columna $hdr @('Kilometraje Inicial')
    $colKmFin = Buscar-Columna $hdr @('Kilometraje Final')
    $colKmTot = Buscar-Columna $hdr @('Kil*metros Totales trabajados')
    $colStandBy = Buscar-Columna $hdr @('Kil*metros*Stand*by*')
    $colKmPagar = Buscar-Columna $hdr @('Total Kil*metros a pagar')
    $colCantidad = Buscar-Columna $hdr @('Cantidad transportada*')
    $colM3Km = Buscar-Columna $hdr @('Transporte de material*')
    $colUnidad = Buscar-Columna $hdr @('Unidad')
    $colObs = Buscar-Columna $hdr @('Observaciones')
    $colActaNo = Buscar-Columna $hdr @('Acta No*')
    $colDia = Buscar-Columna $hdr @('D*a sem')
    $colHabil = Buscar-Columna $hdr @('Dia h*bil')

    $faltantes = @()
    $mapaColumnas = @{
        'Fecha' = $colFecha; 'UF' = $colUF; 'Actividad' = $colActividad; 'CC' = $colCC
        'Remision' = $colRemision; 'Placa' = $colPlaca; 'KmIni' = $colKmIni; 'KmFin' = $colKmFin
        'KmTot' = $colKmTot; 'StandBy' = $colStandBy; 'KmPagar' = $colKmPagar
        'Cantidad' = $colCantidad; 'M3Km' = $colM3Km; 'Unidad' = $colUnidad; 'Obs' = $colObs
        'ActaNo' = $colActaNo; 'Dia' = $colDia; 'Habil' = $colHabil
    }
    foreach ($k in $mapaColumnas.Keys) {
        if ($null -eq $mapaColumnas[$k]) { $faltantes += $k }
    }
    if ($faltantes.Count -gt 0) {
        throw "No se encontraron columnas por encabezado: $($faltantes -join ', ')"
    }

    $rangoAntes = $lo.Range.Address($false, $false)
    $filasAntes = $lo.ListRows.Count

    # --- 4) Plantillas de fórmula (de la última fila existente, antes de agregar nada) ---
    $ultimaFila = $lo.ListRows.Item($filasAntes).Range
    $fTemplateDia = $ultimaFila.Cells.Item(1, $colDia).Formula
    $fTemplateHabil = $ultimaFila.Cells.Item(1, $colHabil).Formula
    $fTemplateStandBy = $ultimaFila.Cells.Item(1, $colStandBy).Formula
    $fTemplateKmPagar = $ultimaFila.Cells.Item(1, $colKmPagar).Formula
    $fTemplateObs = $ultimaFila.Cells.Item(1, $colObs).Formula
    $fTemplateActaNoOriginal = $ultimaFila.Cells.Item(1, $colActaNo).Formula

    # Km totales (M): la fórmula por defecto de la columna calculada puede ser una versión vieja sin ABS
    # (da km NEGATIVOS cuando el viaje va hacia atrás, p. ej. PK21+800 -> PK15+800). Se toma la del dueño
    # de la fila más reciente que la tenga (=ABS(Kilometraje Final - Kilometraje Inicial)/1000).
    $fTemplateKmTot = $null
    for ($i = $filasAntes; $i -ge [Math]::Max(1, $filasAntes - 500); $i--) {
        $fm = [string]$lo.ListRows.Item($i).Range.Cells.Item(1, $colKmTot).Formula
        if ($fm -match '^=.*ABS\(.*Kilometraje Final') { $fTemplateKmTot = $fm; break }
    }
    $hayKmIniNumerico = @($filasEntrada | Where-Object { Es-Numerico ([string]$_.kmIni) }).Count -gt 0
    if (-not $fTemplateKmTot -and $hayKmIniNumerico) { throw "No encontré en las últimas filas la fórmula de 'Kilómetros Totales trabajados' con ABS; revisa la tabla antes de escribir." }

    # Reconstruir 'Acta No.' con textos provisionales (misma estructura IF UF1/UF2)
    $reActaNo = [regex]'^(.*IF\(.*?,\s*)"[^"]*"\s*,\s*"[^"]*"(\).*)$'
    $m = $reActaNo.Match($fTemplateActaNoOriginal)
    if (-not $m.Success) {
        throw "No se pudo interpretar la fórmula de 'Acta No.' de la última fila para sustituir los textos provisionales: $fTemplateActaNoOriginal"
    }
    $fTemplateActaNoProvisional = $m.Groups[1].Value + '"' + $TextoProvisionalUF1 + '","' + $TextoProvisionalUF2 + '"' + $m.Groups[2].Value

    # --- 5) Agregar las filas ---
    $resumenFilas = @()
    $indiceFilaActual = 0
    foreach ($fila in $filasEntrada) {
        $indiceFilaActual++
        if (-not $fila.fecha -or $fila.fecha -notmatch '^\d{2}/\d{2}/\d{4}$') {
            throw "fecha inválida (se espera dd/mm/aaaa): '$($fila.fecha)'"
        }
        $kmIniTexto = [string]$fila.kmIni
        $kmIniEsNumero = Es-Numerico $kmIniTexto

        if (-not $kmIniEsNumero -and (-not $fila.PSObject.Properties.Match('kmTot').Count -or $null -eq $fila.kmTot)) {
            throw "Fila con Kilometraje Inicial no numérico ('$kmIniTexto') debe traer 'kmTot' en el json"
        }

        $nuevaListRow = $lo.ListRows.Add()
        $rango = $nuevaListRow.Range

        # -- columnas de entrada --
        $celdaFecha = $rango.Cells.Item(1, $colFecha)
        $celdaFecha.NumberFormat = '@'
        $celdaFecha.Value2 = [string]$fila.fecha

        $rango.Cells.Item(1, $colUF).Value2 = [string]$fila.uf
        $rango.Cells.Item(1, $colActividad).Value2 = [string]$fila.actividad

        $celdaCC = $rango.Cells.Item(1, $colCC)
        $celdaCC.NumberFormat = '@'
        $celdaCC.Value2 = [string]$fila.cc

        $rango.Cells.Item(1, $colRemision).Value2 = [double]$fila.remision
        $rango.Cells.Item(1, $colPlaca).Value2 = [string]$fila.placa

        $celdaKmIni = $rango.Cells.Item(1, $colKmIni)
        if ($kmIniEsNumero) {
            $celdaKmIni.Value2 = [double]$kmIniTexto
        } else {
            $celdaKmIni.NumberFormat = '@'
            $celdaKmIni.Value2 = $kmIniTexto
        }
        $rango.Cells.Item(1, $colKmFin).Value2 = [double]$fila.kmFin

        $rango.Cells.Item(1, $colCantidad).Value2 = [double]$fila.m3

        $unidad = 'm3km'
        if ($fila.PSObject.Properties.Match('unidad').Count -gt 0 -and $fila.unidad) { $unidad = [string]$fila.unidad }
        $rango.Cells.Item(1, $colUnidad).Value2 = $unidad

        # -- columnas calculadas: copiar fórmula de la tabla --
        $rango.Cells.Item(1, $colDia).Formula = $fTemplateDia
        $rango.Cells.Item(1, $colHabil).Formula = $fTemplateHabil
        $rango.Cells.Item(1, $colStandBy).Formula = $fTemplateStandBy
        $rango.Cells.Item(1, $colKmPagar).Formula = $fTemplateKmPagar
        $rango.Cells.Item(1, $colActaNo).Formula = $fTemplateActaNoProvisional

        # -- Km totales trabajados (M) y Transporte de material m3*Km (Q):
        #    son columnas calculadas de la tabla (fórmula), Excel las autocompleta
        #    solo al agregar la fila (ListRows.Add). Con Kilometraje Inicial numérico
        #    se dejan tal cual (la fórmula de M calcula (KmFin-KmIni)/1000 y la de Q,
        #    Cantidad*M). Si Kilometraje Inicial no es numérico (p. ej. "Planta Putana"),
        #    la fórmula de M da #VALOR!: se sobrescribe M con el literal 'kmTot' del
        #    json (vía .Formula, como constante, para no chocar con el error de tipos
        #    de PowerShell/COM al usar .Value2 sobre una celda con fórmula); Q recalcula
        #    solo porque su fórmula referencia a M por nombre de columna.
        if ($kmIniEsNumero) {
            $rango.Cells.Item(1, $colKmTot).Formula = $fTemplateKmTot
            $kmTot = [Math]::Round([Math]::Abs([double]$fila.kmFin - [double]$kmIniTexto) / 1000.0, 2)
        } else {
            $kmTot = [double]$fila.kmTot
            $celdaKmTot = $rango.Cells.Item(1, $colKmTot)
            $celdaKmTot.Formula = '=' + $kmTot.ToString([System.Globalization.CultureInfo]::InvariantCulture)
        }
        $m3km = $kmTot * [double]$fila.m3
        # Q con literal en la tabla (libros sin columna calculada): se le pone =Cantidad*M
        $celdaQ = $rango.Cells.Item(1, $colM3Km)
        if (-not ([string]$celdaQ.Formula).StartsWith('=')) {
            $celdaQ.Formula = '=' + $rango.Cells.Item(1, $colCantidad).Address($false, $false) + '*' + $rango.Cells.Item(1, $colKmTot).Address($false, $false)
        }

        # -- Observaciones (S): literal si viene 'obs', si no la fórmula de la tabla --
        if ($fila.PSObject.Properties.Match('obs').Count -gt 0 -and $fila.obs) {
            $rango.Cells.Item(1, $colObs).Value2 = [string]$fila.obs
        } else {
            $rango.Cells.Item(1, $colObs).Formula = $fTemplateObs
        }

        $resumenFilas += [pscustomobject]@{
            fecha    = [string]$fila.fecha
            placa    = [string]$fila.placa
            remision = $fila.remision
            kmTot    = $kmTot
            m3       = [double]$fila.m3
            m3km     = $m3km
        }
    }

    # --- 6) Refrescar tablas dinámicas de la hoja ---
    if (-not $SinRefrescar) {
        try {
            foreach ($pt in $ws.PivotTables()) {
                $pt.RefreshTable() | Out-Null
            }
        } catch {
            # La hoja puede no tener tablas dinámicas; no es un error.
        }
    }

    $excel.CalculateFullRebuild()
    $libroCom.Save()

    $rangoDespues = $lo.Range.Address($false, $false)
    $filasDespues = $lo.ListRows.Count

    # --- 7) Totales de las filas nuevas leídos de Excel tras recalcular ---
    $totalM3 = 0.0
    $totalM3Km = 0.0
    for ($i = $filasAntes + 1; $i -le $filasDespues; $i++) {
        $r = $lo.ListRows.Item($i).Range
        $totalM3 += [double]$r.Cells.Item(1, $colCantidad).Value2
        $totalM3Km += [double]$r.Cells.Item(1, $colM3Km).Value2
    }

    $resumen = [pscustomobject]@{
        ok            = $true
        libroOriginal = (Resolve-Path -LiteralPath $Libro).Path
        salida        = (Resolve-Path -LiteralPath $Salida).Path
        hoja          = $Hoja
        filasAgregadas = ($filasDespues - $filasAntes)
        rangoAntes    = $rangoAntes
        rangoDespues  = $rangoDespues
        filasAntes    = $filasAntes
        filasDespues  = $filasDespues
        totalM3NuevasFilas    = [Math]::Round($totalM3, 4)
        totalM3KmNuevasFilas  = [Math]::Round($totalM3Km, 4)
        detalleFilas  = $resumenFilas
    }
}
catch {
    Write-Error ("Error procesando la fila de entrada #$indiceFilaActual : " + $_.Exception.Message)
    throw
}
finally {
    # Soltar toda referencia COM intermedia (hojas, tablas, rangos, celdas)
    # ANTES de Quit(): si queda una variable de script viva apuntando a un
    # objeto COM de Excel, el proceso EXCEL.EXE no termina aunque se llame
    # Quit(), porque el runtime de COM interop no libera esas referencias
    # hasta el GC, y el GC no libera nada que siga "rooteado" en una variable.
    $ws = $null; $lo = $null; $hdr = $null; $ultimaFila = $null; $t = $null
    $nuevaListRow = $null; $rango = $null
    $celdaFecha = $null; $celdaCC = $null; $celdaKmIni = $null; $celdaKmTot = $null
    $pt = $null

    if ($libroCom) {
        try { $libroCom.Close($true) } catch {}
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($libroCom)
        $libroCom = $null
    }
    if ($excel) {
        try { $excel.Quit() } catch {}
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
        $excel = $null
    }
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
    [System.GC]::Collect()
}

$resumen | ConvertTo-Json -Depth 6
