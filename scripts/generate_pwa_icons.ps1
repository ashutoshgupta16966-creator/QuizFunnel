Add-Type -AssemblyName System.Drawing

function Generate-PwaIcon {
    param(
        [int]$Size,
        [string]$OutPath,
        [bool]$Maskable = $false
    )

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    # Background gradient
    $rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
    $c1 = [System.Drawing.ColorTranslator]::FromHtml('#4361EE')
    $c2 = [System.Drawing.ColorTranslator]::FromHtml('#F72585')
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, 45.0)

    if ($Maskable) {
        $g.FillRectangle($brush, $rect)
    } else {
        $radius = [int]($Size * 0.22)
        $d = $radius * 2
        $path = New-Object System.Drawing.Drawing2D.GraphicsPath
        $path.AddArc(0, 0, $d, $d, 180, 90)
        $path.AddArc($Size - $d, 0, $d, $d, 270, 90)
        $path.AddArc($Size - $d, $Size - $d, $d, $d, 0, 90)
        $path.AddArc(0, $Size - $d, $d, $d, 90, 90)
        $path.CloseFigure()
        $g.FillPath($brush, $path)
    }

    # Inner subtle dark overlay
    $darkColor = [System.Drawing.Color]::FromArgb(60, 13, 27, 42)
    $darkBrush = New-Object System.Drawing.SolidBrush($darkColor)
    $inset = [float]($Size * 0.05)
    $innerSize = [float]($Size - ($inset * 2.0))
    $g.FillEllipse($darkBrush, $inset, $inset, $innerSize, $innerSize)

    $scale = [float]($Size / 512.0)

    # Mortarboard Top (Diamond)
    $pt1 = New-Object System.Drawing.PointF([float](100.0 * $scale), [float](100.0 * $scale))
    $pt2 = New-Object System.Drawing.PointF([float](400.0 * $scale), [float](300.0 * $scale))
    $polyBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $pt1,
        $pt2,
        [System.Drawing.ColorTranslator]::FromHtml('#4CC9F0'),
        [System.Drawing.ColorTranslator]::FromHtml('#10B981')
    )
    [System.Drawing.PointF[]]$topPoints = @(
        (New-Object System.Drawing.PointF([float](256.0 * $scale), [float](130.0 * $scale))),
        (New-Object System.Drawing.PointF([float](416.0 * $scale), [float](210.0 * $scale))),
        (New-Object System.Drawing.PointF([float](256.0 * $scale), [float](290.0 * $scale))),
        (New-Object System.Drawing.PointF([float](96.0 * $scale), [float](210.0 * $scale)))
    )
    $g.FillPolygon($polyBrush, $topPoints)

    # Mortarboard Cap Base (White)
    $capBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(240, 255, 255, 255))
    $capPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $capPath.AddLine([float](166.0 * $scale), [float](230.0 * $scale), [float](166.0 * $scale), [float](275.0 * $scale))
    $capPath.AddBezier(
        [float](166.0 * $scale), [float](275.0 * $scale),
        [float](166.0 * $scale), [float](330.0 * $scale),
        [float](346.0 * $scale), [float](330.0 * $scale),
        [float](346.0 * $scale), [float](275.0 * $scale)
    )
    $capPath.AddLine([float](346.0 * $scale), [float](275.0 * $scale), [float](346.0 * $scale), [float](230.0 * $scale))
    $capPath.CloseFigure()
    $g.FillPath($capBrush, $capPath)

    # Golden Tassel
    $tasselPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#FFD700'), [float](8.0 * $scale))
    $tasselPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $tasselPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawBezier(
        $tasselPen,
        [float](256.0 * $scale), [float](210.0 * $scale),
        [float](340.0 * $scale), [float](215.0 * $scale),
        [float](375.0 * $scale), [float](250.0 * $scale),
        [float](396.0 * $scale), [float](280.0 * $scale)
    )
    $tasselBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#FFD700'))
    $g.FillEllipse($tasselBrush, [float](386.0 * $scale), [float](274.0 * $scale), [float](20.0 * $scale), [float](20.0 * $scale))

    # Funnel Lines
    $funnelPen1 = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#4CC9F0'), [float](14.0 * $scale))
    $funnelPen1.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $funnelPen1.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawLine($funnelPen1, [float](176.0 * $scale), [float](370.0 * $scale), [float](336.0 * $scale), [float](370.0 * $scale))

    $funnelPen2 = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml('#FFD700'), [float](12.0 * $scale))
    $funnelPen2.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $funnelPen2.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawLine($funnelPen2, [float](216.0 * $scale), [float](410.0 * $scale), [float](296.0 * $scale), [float](410.0 * $scale))

    $dotBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#F72585'))
    $g.FillEllipse($dotBrush, [float](246.0 * $scale), [float](442.0 * $scale), [float](20.0 * $scale), [float](20.0 * $scale))

    $fullOut = [System.IO.Path]::GetFullPath($OutPath)
    $bmp.Save($fullOut, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Host "Generated $fullOut"
}

Generate-PwaIcon -Size 192 -OutPath 'client/public/icon-192x192.png'
Generate-PwaIcon -Size 512 -OutPath 'client/public/icon-512x512.png'
Generate-PwaIcon -Size 192 -OutPath 'client/public/icon-maskable-192x192.png' -Maskable $true
Generate-PwaIcon -Size 512 -OutPath 'client/public/icon-maskable-512x512.png' -Maskable $true
